"""Windows-only paired loopback CAD relay. No cloud client or general command API."""
from __future__ import annotations
import argparse, base64, collections, ctypes, hashlib, hmac, json, msvcrt, os
import pathlib, re, secrets, socket, sqlite3, subprocess, sys, threading, time, uuid, zipfile
from ctypes import wintypes
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

MAX_TASK = 1_000_000
MAX_BODY = 2_100_000
MAX_RESULT = 8 * 1024 * 1024
MAX_LOG = 2 * 1024 * 1024
SESSION_SECONDS = 12 * 3600
PAIR_SECONDS = 600
RECEIPT_SCHEMA = 'execution-receipt-v1'
HEX64 = re.compile(r'^[0-9a-f]{64}$')

def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)

def now():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')

def b64(value):
    return base64.urlsafe_b64encode(value).decode('ascii').rstrip('=')

def sha(value):
    return hashlib.sha256(value).hexdigest()

def file_sha(path, maximum=None):
    if maximum is not None and path.stat().st_size > maximum:
        raise ValueError('File exceeds permitted size')
    h = hashlib.sha256()
    total = 0
    with path.open('rb') as f:
        while block := f.read(65536):
            total += len(block)
            if maximum is not None and total > maximum:
                raise ValueError('File exceeds permitted size')
            h.update(block)
    return h.hexdigest()

def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate JSON key')
        result[key] = value
    return result

def json_read(text):
    return json.loads(text, object_pairs_hook=unique_object,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Non-finite JSON number')))

def valid_uuid(value):
    try:
        return isinstance(value, str) and str(uuid.UUID(value)) == value
    except (ValueError, AttributeError):
        return False

def integer(value):
    return type(value) is int and 1 <= value <= 2_147_483_647

class APIError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


# DPAPI uses the current user's profile. CRYPTPROTECT_LOCAL_MACHINE is NEVER set.
class Blob(ctypes.Structure):
    _fields_ = [('cbData', wintypes.DWORD), ('pbData', ctypes.POINTER(ctypes.c_ubyte))]

def dpapi(data, protect):
    raw = ctypes.create_string_buffer(data)
    src = Blob(len(data), ctypes.cast(raw, ctypes.POINTER(ctypes.c_ubyte)))
    result = Blob()
    crypt = ctypes.WinDLL('crypt32', use_last_error=True)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    if protect:
        fn = crypt.CryptProtectData
        fn.argtypes = [ctypes.POINTER(Blob), wintypes.LPCWSTR, ctypes.POINTER(Blob), ctypes.c_void_p,
                       ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
        ok = fn(ctypes.byref(src), 'AI3D local executor identity v1', None, None, None,
                0x1, ctypes.byref(result))
    else:
        fn = crypt.CryptUnprotectData
        fn.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.POINTER(Blob), ctypes.c_void_p,
                       ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
        ok = fn(ctypes.byref(src), None, None, None, None, 0x1, ctypes.byref(result))
    if not ok:
        raise RuntimeError('Current-user DPAPI identity operation failed')
    try:
        return ctypes.string_at(result.pbData, result.cbData)
    finally:
        kernel.LocalFree(ctypes.cast(result.pbData, ctypes.c_void_p))


class IOCounters(ctypes.Structure):
    _fields_ = [(n, ctypes.c_ulonglong) for n in ('ReadOperationCount', 'WriteOperationCount',
                'OtherOperationCount', 'ReadTransferCount', 'WriteTransferCount', 'OtherTransferCount')]

class BasicJobLimits(ctypes.Structure):
    _fields_ = [('PerProcessUserTimeLimit', ctypes.c_longlong), ('PerJobUserTimeLimit', ctypes.c_longlong),
                ('LimitFlags', wintypes.DWORD), ('MinimumWorkingSetSize', ctypes.c_size_t),
                ('MaximumWorkingSetSize', ctypes.c_size_t), ('ActiveProcessLimit', wintypes.DWORD),
                ('Affinity', ctypes.c_size_t), ('PriorityClass', wintypes.DWORD), ('SchedulingClass', wintypes.DWORD)]

class ExtendedJobLimits(ctypes.Structure):
    _fields_ = [('BasicLimitInformation', BasicJobLimits), ('IoInfo', IOCounters),
                ('ProcessMemoryLimit', ctypes.c_size_t), ('JobMemoryLimit', ctypes.c_size_t),
                ('PeakProcessMemoryUsed', ctypes.c_size_t), ('PeakJobMemoryUsed', ctypes.c_size_t)]

class ProcessJob:
    """Kill descendants when the owning controller dies or the job is closed."""
    def __init__(self):
        self.kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        self.kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        self.kernel.CreateJobObjectW.restype = wintypes.HANDLE
        self.kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        self.kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        self.kernel.TerminateJobObject.argtypes = [wintypes.HANDLE, wintypes.UINT]
        self.kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        self.handle = self.kernel.CreateJobObjectW(None, None)
        if not self.handle:
            raise RuntimeError('Cannot create Windows process job')
        limits = ExtendedJobLimits()
        limits.BasicLimitInformation.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not self.kernel.SetInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            self.close()
            raise RuntimeError('Cannot set Windows process containment')

    def assign(self, process):
        if not self.kernel.AssignProcessToJobObject(self.handle, wintypes.HANDLE(int(process._handle))):
            raise RuntimeError('Cannot contain CAD process; execution stopped')

    def kill(self):
        if self.handle:
            self.kernel.TerminateJobObject(self.handle, 1)

    def close(self):
        if self.handle:
            self.kernel.CloseHandle(self.handle)
            self.handle = None


class Relay:
    def __init__(self, args):
        self.origin = args.origin
        self.registration_origin = args.registration_origin or args.origin
        self.state_dir = pathlib.Path(args.state_dir).resolve()
        self.python = pathlib.Path(args.cad_python).resolve(strict=True)
        self.runner = pathlib.Path(args.cad_runner).resolve(strict=True)
        if not self.python.is_file() or not self.runner.is_file():
            raise ValueError('Configured CAD Python and runner must be files')
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.process_lock = (self.state_dir / 'controller.lock').open('a+b')
        if self.process_lock.seek(0, 2) == 0:
            self.process_lock.write(b'0'); self.process_lock.flush()
        self.process_lock.seek(0)
        try:
            msvcrt.locking(self.process_lock.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError as error:
            self.process_lock.close()
            raise RuntimeError('This state directory already has a running controller') from error
        self.lock = threading.RLock()
        self.stopping = False
        self.active_key = None
        self.active_process_job = None
        self.worker_thread = None
        self.key, self.device_id = self.load_identity()
        self.label = args.label
        self.public_key = b64(self.key.public_key().public_bytes(serialization.Encoding.Raw,
                                                                serialization.PublicFormat.Raw))
        self.registration_message = 'AI3D_DEVICE_REGISTRATION_V1\n' + self.registration_origin + '\n' + self.device_id + '\n' + self.public_key
        self.identity = dict(deviceId=self.device_id, publicKey=self.public_key, label=self.label,
                             registrationMessage=self.registration_message,
                             registrationSignature=b64(self.key.sign(self.registration_message.encode('utf-8'))))
        self.code = f'{secrets.randbelow(100_000_000):08d}'
        self.code_deadline = time.monotonic() + PAIR_SECONDS
        self.pair_used = False
        self.pair_attempts = collections.deque()
        self.pair_total = 0
        self.session = None
        self.session_deadline = 0
        self.db_path = self.state_dir / 'runs.sqlite3'
        with self.db() as db:
            db.execute('''CREATE TABLE IF NOT EXISTS runs(
              run_id TEXT NOT NULL, attempt INTEGER NOT NULL, lease_id TEXT NOT NULL,
              job_id TEXT NOT NULL, device_id TEXT NOT NULL, payload_hash TEXT NOT NULL,
              input_hash TEXT NOT NULL, runner_hash TEXT NOT NULL, task_json TEXT NOT NULL,
              status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT,
              receipt_json TEXT, signature TEXT, result_sha TEXT, error TEXT,
              PRIMARY KEY(run_id,attempt,lease_id))''')
            unfinished = db.execute("SELECT run_id,attempt,lease_id FROM runs WHERE status='running'").fetchall()
        for item in unfinished:
            self.finish(tuple(item), 'interrupted', None, 'Controller restarted before completion was committed')

    def db(self):
        # Explicit wrapper closes the connection after commit, before any HTTP publication.
        return DB(self.db_path)

    def load_identity(self):
        path = self.state_dir / 'identity.dpapi.json'
        if path.exists():
            if path.stat().st_size > 16384:
                raise RuntimeError('Identity file exceeds permitted size')
            outer = json_read(path.read_text(encoding='utf-8'))
            if outer.get('schema') != 'ai3d-device-dpapi-v1' or not valid_uuid(outer.get('deviceId')):
                raise RuntimeError('Existing identity file is invalid; identity was not replaced')
            secret = json_read(dpapi(base64.b64decode(outer['protected'], validate=True), False).decode('utf-8'))
            if secret.get('deviceId') != outer['deviceId']:
                raise RuntimeError('Identity binding mismatch')
            key = Ed25519PrivateKey.from_private_bytes(base64.b64decode(secret['privateKey'], validate=True))
            return key, outer['deviceId']
        key = Ed25519PrivateKey.generate(); device_id = str(uuid.uuid4())
        private = key.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw,
                                    serialization.NoEncryption())
        protected = dpapi(canonical(dict(deviceId=device_id, privateKey=base64.b64encode(private).decode())).encode('utf-8'), True)
        outer = dict(schema='ai3d-device-dpapi-v1', deviceId=device_id, protected=base64.b64encode(protected).decode())
        temp = self.state_dir / ('identity-' + str(uuid.uuid4()) + '.tmp')
        with temp.open('xb') as f:
            f.write(canonical(outer).encode('utf-8')); f.flush(); os.fsync(f.fileno())
        os.replace(temp, path)
        return key, device_id

    def pair(self, value):
        if not isinstance(value, dict) or set(value) != {'code'}:
            raise APIError(400, 'Expected only a pairing code')
        with self.lock:
            current = time.monotonic()
            while self.pair_attempts and self.pair_attempts[0] <= current - 60:
                self.pair_attempts.popleft()
            if len(self.pair_attempts) >= 5 or self.pair_total >= 20:
                raise APIError(429, 'Pairing attempts limited; wait or restart the controller')
            self.pair_attempts.append(current); self.pair_total += 1
            if self.pair_used:
                raise APIError(409, 'Pairing code already used')
            if current > self.code_deadline:
                raise APIError(410, 'Pairing code expired; restart the controller')
            code = value['code']
            if not isinstance(code, str) or not re.fullmatch(r'[0-9]{8}', code) or not hmac.compare_digest(code, self.code):
                raise APIError(403, 'Pairing code rejected')
            self.pair_used = True; self.code = ''
            self.session = b64(secrets.token_bytes(32)); self.session_deadline = current + SESSION_SECONDS
            expires = datetime.fromtimestamp(time.time() + SESSION_SECONDS, timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
            return dict(sessionToken=self.session, expiresAt=expires, identity=self.identity)

    def authenticate(self, token):
        with self.lock:
            if not isinstance(token, str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}', token) or not self.session or time.monotonic() >= self.session_deadline or not hmac.compare_digest(token, self.session):
                raise APIError(401, 'Executor session missing or expired')

    def lookup(self, key):
        with self.db() as db:
            return db.execute('SELECT * FROM runs WHERE run_id=? AND attempt=? AND lease_id=?', key).fetchone()

    @staticmethod
    def summary(row):
        return dict(runId=row['run_id'], attempt=row['attempt'], leaseId=row['lease_id'], jobId=row['job_id'],
                    deviceId=row['device_id'], status=row['status'], startedAt=row['started_at'],
                    receiptJson=row['receipt_json'], signature=row['signature'])

    def folder(self, key):
        # Values have already passed UUID/int validation. Never accept caller paths.
        result = (self.state_dir / 'runs' / key[0] / str(key[1]) / key[2]).resolve()
        if not result.is_relative_to(self.state_dir):
            raise RuntimeError('Run folder escaped state directory')
        return result

    def submit(self, value):
        fields = {'runId', 'attempt', 'leaseId', 'jobId', 'deviceId', 'inputSha256', 'runnerSha256', 'taskJson'}
        if not isinstance(value, dict) or set(value) != fields:
            raise APIError(400, 'Run fields do not match the approved contract')
        if not all(valid_uuid(value[k]) for k in ('runId', 'leaseId', 'jobId', 'deviceId')) or not integer(value['attempt']) or value['attempt'] > 1000:
            raise APIError(400, 'Run identity invalid')
        if value['deviceId'] != self.device_id:
            raise APIError(409, 'Task belongs to another device')
        if not all(isinstance(value[k], str) and HEX64.fullmatch(value[k]) for k in ('inputSha256', 'runnerSha256')):
            raise APIError(400, 'Expected lowercase SHA-256 hashes')
        text = value['taskJson']
        if not isinstance(text, str) or len(text.encode('utf-8')) > MAX_TASK:
            raise APIError(413, 'CAD task exceeds 1 MB')
        if sha(text.encode('utf-8')) != value['inputSha256']:
            raise APIError(400, 'Task byte hash mismatch')
        try:
            task = json_read(text)
            if not isinstance(task, dict) or set(task) != {'schema', 'jobId', 'projectId', 'projectRevision', 'designJson', 'designSha256'}:
                raise ValueError('Task fields invalid')
            if task['schema'] != 'cad-task-v1' or task['jobId'] != value['jobId'] or not valid_uuid(task['projectId']) or not integer(task['projectRevision']):
                raise ValueError('CAD task identity invalid')
            if not isinstance(task['designJson'], str) or sha(task['designJson'].encode('utf-8')) != task['designSha256']:
                raise ValueError('CAD design hash mismatch')
            json_read(task['designJson'])
        except (ValueError, TypeError, KeyError, RecursionError):
            raise APIError(400, 'CAD task JSON or identity invalid')
        key = (value['runId'], value['attempt'], value['leaseId'])
        payload_hash = sha(canonical(value).encode('utf-8'))
        with self.lock:
            previous = self.lookup(key)
            if previous:
                if previous['payload_hash'] != payload_hash:
                    raise APIError(409, 'Same run/attempt/lease has different input')
                return 200, self.summary(previous)
            if self.stopping or self.active_key is not None:
                raise APIError(409, 'Executor already has an active process')
            if file_sha(self.runner, 2_000_000) != value['runnerSha256']:
                raise APIError(409, 'Installed runner hash does not match this task')
            with self.db() as db:
                if db.execute("SELECT 1 FROM runs WHERE status='running' LIMIT 1").fetchone():
                    raise APIError(409, 'Executor has an unfinished run')
                db.execute('''INSERT INTO runs(run_id,attempt,lease_id,job_id,device_id,payload_hash,
                  input_hash,runner_hash,task_json,status,started_at) VALUES(?,?,?,?,?,?,?,?,?,'running',?)''',
                  (*key, value['jobId'], self.device_id, payload_hash, value['inputSha256'], value['runnerSha256'], text, now()))
            self.active_key = key
            self.worker_thread = threading.Thread(target=self.execute, args=(key,), daemon=True, name='cad-executor')
            try:
                self.worker_thread.start()
            except Exception:
                self.active_key = None
                self.finish(key, 'failed', None, 'Could not start execution worker')
                raise APIError(503, 'Execution worker could not start')
            return 202, self.summary(self.lookup(key))

    def finish(self, key, status, result_hash, error):
        with self.lock:
            row = self.lookup(key)
            if not row or row['status'] != 'running':
                return
            stamp = now()
            receipt = dict(schema=RECEIPT_SCHEMA, runId=row['run_id'], attempt=row['attempt'], leaseId=row['lease_id'],
                           jobId=row['job_id'], deviceId=self.device_id, inputSha256=row['input_hash'],
                           runnerSha256=row['runner_hash'], resultSha256=result_hash, status=status,
                           startedAt=row['started_at'], finishedAt=stamp, error=str(error)[:1000])
            receipt_json = canonical(receipt)
            signature = b64(self.key.sign(receipt_json.encode('utf-8')))
            with self.db() as db:
                db.execute('''UPDATE runs SET status=?,finished_at=?,receipt_json=?,signature=?,result_sha=?,error=?
                   WHERE run_id=? AND attempt=? AND lease_id=? AND status='running' ''',
                   (status, stamp, receipt_json, signature, result_hash, receipt['error'], *key))

    def execute(self, key):
        process = None; job = None
        try:
            row = self.lookup(key); folder = self.folder(key); folder.mkdir(parents=True, exist_ok=False)
            task_path = folder / 'task.json'; result_path = folder / 'result.zip'
            with task_path.open('xb') as f:
                f.write(row['task_json'].encode('utf-8')); f.flush(); os.fsync(f.fileno())
            if file_sha(task_path, MAX_TASK) != row['input_hash'] or file_sha(self.runner, 2_000_000) != row['runner_hash']:
                raise RuntimeError('Input or runner changed before execution')
            command = [str(self.python), str(self.runner), str(task_path), '--output', str(result_path)]
            job = ProcessJob()
            with self.lock:
                self.active_process_job = job
                if self.stopping:
                    raise RuntimeError('Controller is stopping')
            stdout_path = folder / 'stdout.log'; stderr_path = folder / 'stderr.log'
            with stdout_path.open('xb') as stdout, stderr_path.open('xb') as stderr:
                process = subprocess.Popen(command, cwd=str(folder), stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr,
                                           creationflags=subprocess.CREATE_NO_WINDOW, close_fds=True, shell=False)
                try:
                    job.assign(process)
                except Exception:
                    process.kill(); process.wait(timeout=5)
                    raise
                deadline = time.monotonic() + 210
                while process.poll() is None:
                    if self.stopping:
                        raise RuntimeError('Controller stopped during execution')
                    if time.monotonic() >= deadline:
                        raise RuntimeError('CAD execution exceeded 210 seconds')
                    if stdout_path.stat().st_size > MAX_LOG or stderr_path.stat().st_size > MAX_LOG:
                        raise RuntimeError('CAD log exceeded permitted size')
                    time.sleep(.05)
                stdout.flush(); stderr.flush(); os.fsync(stdout.fileno()); os.fsync(stderr.fileno())
            if process.returncode != 0:
                with stderr_path.open('rb') as f:
                    f.seek(max(0, stderr_path.stat().st_size - 3000))
                    detail = f.read(3000).decode('utf-8', errors='replace')
                raise RuntimeError(('CAD process exited ' + str(process.returncode) + ': ' + detail)[-1000:])
            if not result_path.is_file() or result_path.stat().st_size == 0 or not zipfile.is_zipfile(result_path):
                raise RuntimeError('CAD did not produce a result ZIP')
            result_hash = file_sha(result_path, MAX_RESULT)
            if file_sha(task_path, MAX_TASK) != row['input_hash'] or file_sha(self.runner, 2_000_000) != row['runner_hash']:
                raise RuntimeError('Input or runner changed during execution')
            with result_path.open('r+b') as f:
                os.fsync(f.fileno())
            self.finish(key, 'succeeded', result_hash, '')
        except Exception as error:
            self.finish(key, 'interrupted' if self.stopping else 'failed', None, str(error))
        finally:
            if job:
                job.kill(); job.close()
            if process:
                try: process.wait(timeout=5)
                except subprocess.TimeoutExpired: process.kill()
            with self.lock:
                if self.active_key == key:
                    self.active_key = None; self.active_process_job = None

    def close(self):
        with self.lock:
            self.stopping = True
            if self.active_process_job:
                self.active_process_job.kill()
        if self.worker_thread and self.worker_thread.is_alive():
            self.worker_thread.join(timeout=8)
        if self.active_key:
            self.finish(self.active_key, 'interrupted', None, 'Controller stopped before completion was committed')
        self.process_lock.close()


class DB:
    def __init__(self, path): self.path = path
    def __enter__(self):
        self.connection = sqlite3.connect(self.path, timeout=5)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute('PRAGMA synchronous=FULL')
        self.connection.execute('BEGIN IMMEDIATE')
        return self.connection
    def __exit__(self, kind, value, trace):
        try:
            if kind is None: self.connection.commit()
            else: self.connection.rollback()
        finally: self.connection.close()


class HTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 16
    def __init__(self, address, relay):
        self.relay = relay; self.slots = threading.BoundedSemaphore(32)
        super().__init__(address, Handler)
    def process_request(self, request, address):
        if not self.slots.acquire(blocking=False):
            request.close(); return
        try: super().process_request(request, address)
        except Exception:
            self.slots.release(); raise
    def process_request_thread(self, request, address):
        try: super().process_request_thread(request, address)
        finally: self.slots.release()
    def handle_error(self, request, client_address): pass


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'AI3DLocalExecutor/1'
    sys_version = ''
    def setup(self):
        super().setup(); self.connection.settimeout(10)
    def log_message(self, *args): pass
    def header(self, name):
        values = self.headers.get_all(name, [])
        if len(values) > 1: raise APIError(400, 'Duplicate header')
        return values[0] if values else None
    def gate(self):
        if self.header('Host') != '127.0.0.1:' + str(self.server.server_port):
            raise APIError(403, 'Host rejected')
        if self.header('Origin') != self.server.relay.origin:
            raise APIError(403, 'Origin rejected')
        if self.header('Transfer-Encoding') is not None:
            raise APIError(400, 'Transfer encoding not supported')
    def send_bytes(self, status, data, mime='application/json', extra=None):
        self.send_response(status)
        if self.headers.get('Origin') == self.server.relay.origin:
            self.send_header('Access-Control-Allow-Origin', self.server.relay.origin)
            self.send_header('Vary', 'Origin')
        self.send_header('Content-Type', mime); self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store'); self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Connection', 'close')
        for key, value in (extra or {}).items(): self.send_header(key, value)
        self.end_headers(); self.close_connection = True
        if data and self.command != 'HEAD': self.wfile.write(data)
    def send_json(self, status, value):
        self.send_bytes(status, canonical(value).encode('utf-8'))
    def body(self, maximum):
        content_type = self.header('Content-Type') or ''
        if content_type.lower() not in ('application/json', 'application/json; charset=utf-8'):
            raise APIError(415, 'Content-Type must be application/json')
        length = self.header('Content-Length')
        if not length or not re.fullmatch(r'[0-9]{1,9}', length):
            raise APIError(411, 'A single Content-Length is required')
        size = int(length)
        if size < 1 or size > maximum: raise APIError(413, 'Request body exceeds permitted size')
        raw = self.rfile.read(size)
        if len(raw) != size: raise APIError(400, 'Request body incomplete')
        try: return json_read(raw.decode('utf-8'))
        except (ValueError, UnicodeError, RecursionError): raise APIError(400, 'JSON invalid')
    def route(self):
        self.gate(); relay = self.server.relay
        if self.command == 'OPTIONS':
            if self.path not in ('/pair', '/status', '/runs') and not self.path.startswith('/runs/'):
                raise APIError(404, 'Route not found')
            if self.header('Access-Control-Request-Method') not in ('GET', 'POST'):
                raise APIError(403, 'Preflight method rejected')
            names = [n.strip().lower() for n in (self.header('Access-Control-Request-Headers') or '').split(',') if n.strip()]
            if not set(names) <= {'content-type', 'x-executor-token'}:
                raise APIError(403, 'Preflight header rejected')
            self.send_bytes(204, b'', extra={'Access-Control-Allow-Methods':'GET, POST',
                'Access-Control-Allow-Headers':'Content-Type, X-Executor-Token',
                'Access-Control-Allow-Private-Network':'true', 'Access-Control-Max-Age':'60'})
            return
        if self.command == 'POST' and self.path == '/pair':
            self.send_json(200, relay.pair(self.body(1024))); return
        relay.authenticate(self.header('X-Executor-Token'))
        if self.command == 'GET' and self.path == '/status':
            with relay.lock:
                active = relay.lookup(relay.active_key) if relay.active_key else None
                status = dict(identity=relay.identity, state='running' if active else 'idle',
                    activeRun=relay.summary(active) if active else None,
                    runnerSha256=file_sha(relay.runner, 2_000_000), kind='cad_build')
            self.send_json(200, status)
            return
        if self.command == 'POST' and self.path == '/runs':
            code, value = relay.submit(self.body(MAX_BODY)); self.send_json(code, value); return
        match = re.fullmatch(r'/runs/([0-9a-f-]{36})/([1-9][0-9]{0,9})/([0-9a-f-]{36})(/result)?', self.path)
        if self.command == 'GET' and match:
            run_id, attempt, lease_id, result = match.groups(); key = (run_id, int(attempt), lease_id)
            if not valid_uuid(run_id) or not valid_uuid(lease_id) or not integer(key[1]) or key[1] > 1000:
                raise APIError(400, 'Run path invalid')
            row = relay.lookup(key)
            if not row: raise APIError(404, 'Run not found')
            if not result: self.send_json(200, relay.summary(row)); return
            if row['status'] != 'succeeded': raise APIError(409, 'No successful result is available')
            path = relay.folder(key) / 'result.zip'
            if file_sha(path, MAX_RESULT) != row['result_sha']:
                raise APIError(409, 'Stored result bytes changed')
            data = path.read_bytes()
            if len(data) > MAX_RESULT or sha(data) != row['result_sha']:
                raise APIError(409, 'Stored result bytes changed during read')
            self.send_bytes(200, data, 'application/zip'); return
        raise APIError(404, 'Route not found')
    def handle_route(self):
        try: self.route()
        except APIError as error:
            try: self.send_json(error.status, dict(error=str(error)))
            except (OSError, ValueError): pass
        except Exception:
            try: self.send_json(503, dict(error='Local executor operation failed'))
            except (OSError, ValueError): pass
    do_GET = handle_route
    do_POST = handle_route
    do_OPTIONS = handle_route
    do_PUT = handle_route
    do_PATCH = handle_route
    do_DELETE = handle_route
    do_HEAD = handle_route
    do_TRACE = handle_route
    do_CONNECT = handle_route


def origin_value(value):
    try:
        p = urlsplit(value)
        if p.username or p.password or p.path or p.query or p.fragment or not p.hostname:
            raise ValueError()
        port = p.port
        if p.scheme not in ('https', 'http') or (p.scheme == 'http' and p.hostname not in ('localhost', '127.0.0.1', '::1')):
            raise ValueError()
        host = '[' + p.hostname + ']' if ':' in p.hostname else p.hostname
        canonical_origin = p.scheme + '://' + host + ((':' + str(port)) if port and port != (443 if p.scheme == 'https' else 80) else '')
        if value != canonical_origin: raise ValueError()
        return value
    except ValueError:
        raise argparse.ArgumentTypeError('Use an exact HTTPS origin, or explicit HTTP loopback development origin; no path/default port')

def registration_origin_value(value):
    if value == 'http://www.3dprinthub.cn':
        return value
    return origin_value(value)

def main():
    if os.name != 'nt': raise RuntimeError('This relay requires Windows current-user DPAPI and process jobs')
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8837)
    parser.add_argument('--origin', required=True, type=origin_value)
    parser.add_argument('--registration-origin', type=registration_origin_value)
    parser.add_argument('--state-dir', required=True)
    parser.add_argument('--cad-python', required=True)
    parser.add_argument('--cad-runner', required=True)
    parser.add_argument('--label', default='Local CAD executor')
    args = parser.parse_args()
    if not 0 <= args.port <= 65535 or not 1 <= len(args.label) <= 80:
        parser.error('Port or device label invalid')
    relay = Relay(args)
    server = None
    try:
        server = HTTPServer(('127.0.0.1', args.port), relay)
        print(canonical(dict(port=server.server_port, deviceId=relay.device_id, pairCode=relay.code)), flush=True)
        server.serve_forever(poll_interval=.1)
    except KeyboardInterrupt: pass
    finally:
        if server: server.server_close()
        relay.close()

if __name__ == '__main__':
    try: main()
    except Exception as error:
        print('Local CAD relay startup failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
