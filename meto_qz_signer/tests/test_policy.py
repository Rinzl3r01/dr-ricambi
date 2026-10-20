import importlib.util, json, time, unittest, base64, hashlib
from pathlib import Path
from cryptography import x509
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.asymmetric import padding
root=Path(__file__).resolve().parents[3]
spec=importlib.util.spec_from_file_location("policy",Path(__file__).resolve().parents[1]/"models/policy.py")
policy=importlib.util.module_from_spec(spec);spec.loader.exec_module(policy)
def raw(call,params):return json.dumps({"call":call,"params":params,"timestamp":time.time()*1000},separators=(",",":"))
class Tests(unittest.TestCase):
 def test_discovery(self):
  policy.validate_message(raw("printers.find",{}))
  policy.validate_message(raw("socket.open",{"host":"10.0.0.39","port":9100}))
 def test_rejects_other_network_and_calls(self):
  for call,params in [("socket.open",{"host":"8.8.8.8","port":9100}),("socket.open",{"host":"10.0.0.39","port":22}),("file.write",{}),("socket.sendData",{})]:
   with self.assertRaises(ValueError):policy.validate_message(raw(call,params))
 def test_raster_and_target(self):
  zpl="^XA\n^FO0,0\n^GFA,11000,11000,55,"+"00"*11000+"\n^FS\n^XZ\n"
  params={"printer":{"host":"10.0.0.39","port":9100},"options":{"copies":1},"data":[{"type":"raw","format":"command","flavor":"plain","data":zpl}]}
  policy.validate_message(raw("print",params))
  params["data"][0]["data"]=zpl+"~JA"
  with self.assertRaises(ValueError):policy.validate_message(raw("print",params))
 def test_timestamp_duplicates_and_size(self):
  with self.assertRaises(ValueError):policy.validate_message(raw("printers.find",{}),now=time.time()+90)
  with self.assertRaises(ValueError):policy.validate_message('{"call":"printers.find","call":"print","params":{},"timestamp":0}')
  with self.assertRaises(ValueError):policy.validate_message("x"*2000001)
 @unittest.skipUnless((Path.home()/".meto-secrets/qz-production/private-key.pem").exists(), "Private key is stored outside source control")
 def test_real_certificate_signature(self):
  key=serialization.load_pem_private_key((Path.home()/".meto-secrets/qz-production/private-key.pem").read_bytes(),None)
  cert=x509.load_pem_x509_certificate((Path(__file__).resolve().parents[1]/"static/certificate/digital-certificate.txt").read_bytes())
  self.assertEqual(key.public_key().public_numbers(),cert.public_key().public_numbers())
  data=hashlib.sha256(raw("printers.find",{}).encode()).hexdigest().encode()
  signature=key.sign(data,padding.PKCS1v15(),hashes.SHA512())
  cert.public_key().verify(signature,data,padding.PKCS1v15(),hashes.SHA512())
if __name__=="__main__":unittest.main()
