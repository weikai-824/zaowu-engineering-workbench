"""Transport-independent service failures."""


class ServiceError(Exception):
    """A known failure that the HTTP edge can map to a stable error envelope."""

    def __init__(
        self,
        *,
        code: str,
        message: str,
        status_code: int,
        retryable: bool = False,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.retryable = retryable
