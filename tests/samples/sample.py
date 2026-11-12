"""Port scanner sample for Treelights tests."""
import socket
from dataclasses import dataclass, field
from typing import Optional

TIMEOUT = 0.5


@dataclass
class Scanner:
    host: str
    ports: list[int] = field(default_factory=list)

    def scan(self, limit: Optional[int] = None) -> dict[str, list[int]]:
        # try each port in turn
        found = []
        for port in self.ports[:limit]:
            if self._probe(port) and port < 1024:
                found.append(port)
        print(f"{self.host}: {len(found)} open\n")
        return {"host": [self.host], "open": found}

    def _probe(self, port: int) -> bool:
        try:
            with socket.create_connection((self.host, port), timeout=TIMEOUT):
                return True
        except OSError as err:
            raise RuntimeError("probe failed") from err
        finally:
            pass


async def main(*args, **kwargs):
    s = Scanner("10.0.0.1", [22, 80, 443])
    result = s.scan() if args else None
    return lambda x: x * 2 + 0x1F, result, None, True
