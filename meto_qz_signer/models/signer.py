import base64
import hashlib
import os
from datetime import datetime, timezone
from pathlib import Path
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from odoo import api, models
from odoo.exceptions import AccessDenied, UserError
from .policy import validate_message


class MetoQzSigner(models.AbstractModel):
    _name = "meto.qz.signer"
    _description = "Firma limitata alle operazioni METO QZ"

    def _authorize(self):
        if not self.env.user.has_group("meto_qz_signer.group_meto_qz_user"):
            raise AccessDenied()

    def _material(self):
        path = os.environ.get("METO_QZ_PRIVATE_KEY")
        if not path:
            raise UserError("Firma METO non configurata sul server")
        cert_pem = (Path(__file__).resolve().parents[1] / "static/certificate/digital-certificate.txt").read_bytes()
        key = serialization.load_pem_private_key(Path(path).read_bytes(), password=None)
        cert = x509.load_pem_x509_certificate(cert_pem)
        if not isinstance(key, rsa.RSAPrivateKey) or key.key_size != 2048 or key.public_key().public_numbers() != cert.public_key().public_numbers():
            raise UserError("Chiave e certificato METO non corrispondono")
        if not cert.not_valid_before_utc <= datetime.now(timezone.utc) <= cert.not_valid_after_utc:
            raise UserError("Certificato METO non valido alla data corrente")
        return key, cert_pem

    @api.model
    def certificate(self):
        self._authorize()
        _, cert_pem = self._material()
        return cert_pem.decode("ascii")

    @api.model
    def sign_message(self, message):
        self._authorize()
        names = tuple(v.strip() for v in os.environ.get("METO_QZ_PRINTER_NAMES", "Meto 39|Zebra 30").split("|") if v.strip())
        try:
            validate_message(message, names)
        except (ValueError, TypeError, KeyError):
            raise UserError("Richiesta QZ non autorizzata o scaduta") from None
        key, _ = self._material()
        digest = hashlib.sha256(message.encode("utf-8")).hexdigest().encode("ascii")
        return base64.b64encode(key.sign(digest, padding.PKCS1v15(), hashes.SHA512())).decode("ascii")
