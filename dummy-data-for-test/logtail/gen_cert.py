"""
gen_cert.py — Generate a self-signed TLS certificate for the logtail server.

Creates (relative to the dummy-data-for-test/ root):
    certs/logtail.key   — RSA private key (PEM)
    certs/logtail.crt   — Self-signed X.509 certificate (PEM)

The certificate is valid for 10 years and covers:
    DNS: localhost
    IP:  127.0.0.1

Usage (from any directory):
    python -m logtail.gen_cert
    # or directly:
    python logtail/gen_cert.py
"""

import datetime
import ipaddress
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

# certs/ lives next to logtail/ — i.e. in dummy-data-for-test/
_ROOT = Path(__file__).parent.parent
CERT_DIR = _ROOT / "certs"
KEY_FILE = CERT_DIR / "logtail.key"
CERT_FILE = CERT_DIR / "logtail.crt"


def generate() -> None:
    CERT_DIR.mkdir(parents=True, exist_ok=True)

    # Generate RSA private key
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    # Certificate subject / issuer
    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, "logtail-dev"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Local Dev"),
    ])

    now = datetime.datetime.now(datetime.timezone.utc)

    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now)
        .not_valid_after(now + datetime.timedelta(days=3650))
        .add_extension(
            x509.SubjectAlternativeName([
                x509.DNSName("localhost"),
                x509.IPAddress(ipaddress.IPv4Address("127.0.0.1")),
            ]),
            critical=False,
        )
        .add_extension(
            x509.BasicConstraints(ca=True, path_length=None),
            critical=True,
        )
        .sign(key, hashes.SHA256())
    )

    KEY_FILE.write_bytes(
        key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )
    CERT_FILE.write_bytes(cert.public_bytes(serialization.Encoding.PEM))

    print(f"Generated:\n  {KEY_FILE}\n  {CERT_FILE}")


if __name__ == "__main__":
    generate()
