"""Validate the exact JSON before signing its SHA256 digest, as QZ requires."""
import json
import math
import re
import time

IPS = {"10.0.0." + n for n in ("28", "31", "39", "41", "45", "46", "47")}


def validate_message(raw, printer_names=(), now=None):
    if not isinstance(raw, str) or len(raw.encode("utf-8")) > 2000000:
        raise ValueError("Richiesta non valida o troppo grande")
    def unique(pairs):
        obj = {}
        for key, value in pairs:
            if key in obj:
                raise ValueError("Campi duplicati")
            obj[key] = value
        return obj
    msg = json.loads(raw, object_pairs_hook=unique)
    if not isinstance(msg, dict) or set(msg) != {"call", "params", "timestamp"}:
        raise ValueError("Campi richiesta non validi")
    stamp = msg["timestamp"]
    if type(stamp) not in (int, float) or not math.isfinite(stamp) or abs((time.time() if now is None else now) * 1000 - stamp) > 60000:
        raise ValueError("Richiesta scaduta")
    call, params = msg["call"], msg["params"]
    if call == "printers.find" and (params is None or params == {}):
        return
    if not isinstance(params, dict):
        raise ValueError("Parametri non validi")
    if call in ("socket.open", "socket.close"):
        if set(params) - {"host", "port", "options"} or params.get("host") not in IPS or type(params.get("port")) is not int or params["port"] != 9100 or params.get("options") not in (None, {}):
            raise ValueError("Destinazione non autorizzata")
        return
    if call != "print" or set(params) != {"printer", "options", "data"}:
        raise ValueError("Operazione non autorizzata")
    target = params["printer"]
    if not isinstance(target, dict):
        raise ValueError("Stampante non valida")
    network = set(target) == {"host", "port"} and target["host"] in IPS and type(target["port"]) is int and target["port"] == 9100
    local = set(target) == {"name"} and target["name"] in printer_names
    if not network and not local:
        raise ValueError("Stampante non autorizzata")
    opts = params["options"]
    if not isinstance(opts, dict) or opts.get("copies", 1) != 1 or opts.get("forceRaw", False) not in (False, None):
        raise ValueError("Opzioni stampa non valide")
    data = params["data"]
    if not isinstance(data, list) or len(data) != 1 or not isinstance(data[0], dict):
        raise ValueError("Dati stampa non validi")
    job = data[0]
    if set(job) != {"type", "format", "flavor", "data"} or [job.get(k) for k in ("type", "format", "flavor")] != ["raw", "command", "plain"]:
        raise ValueError("Solo ZPL raster METO consentito")
    zpl = job["data"]
    match = re.fullmatch(r"\^XA\n\^FO0,0\n\^GFA,(\d+),(\d+),(\d+),([0-9A-F]+)\n\^FS\n\^XZ\n", zpl) if isinstance(zpl, str) else None
    if not match:
        raise ValueError("Formato raster METO non valido")
    total, repeated, stride = map(int, match.group(1, 2, 3))
    if total != repeated or total * 2 != len(match[4]) or (stride, total) not in {(55, 55*200), (70, 70*240), (100, 100*799)}:
        raise ValueError("Dimensioni raster non consentite")
