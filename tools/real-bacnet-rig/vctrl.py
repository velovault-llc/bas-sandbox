"""
Virtual BACnet controller with scripted ("B.S.'d") sensors — BACpypes3.

Serves a conformant BACnet/IP device (anchored on UDP 47808, fixed
instance) with two analog inputs whose values drift like a real building:

  AI:0  ZN-T  zone temp   — slow sine (occupancy-ish) + fast wiggle (noise)
  AI:1  OAT   outdoor air — long slow sine (diurnal-ish)

Both carry covIncrement 0.5 — subscribe and watch genuine COV traffic.

Run (per machine, set a UNIQUE instance + the machine's LAN address):
  python vctrl.py --name BAS-VCTRL-1 --instance 9001 --address <ip>/24

Part of tools/real-bacnet-rig — see README there.
"""

import asyncio
import math
import time

from bacpypes3.argparse import SimpleArgumentParser
from bacpypes3.app import Application
from bacpypes3.local.analog import AnalogInputObject


async def main() -> None:
    parser = SimpleArgumentParser()
    args = parser.parse_args()
    app = Application.from_args(args)

    zn = AnalogInputObject(
        objectIdentifier=("analogInput", 0),
        objectName="ZN-T",
        presentValue=72.0,
        units="degreesFahrenheit",
        covIncrement=0.5,
        description="scripted zone temp (sine + wiggle)",
    )
    app.add_object(zn)

    oat = AnalogInputObject(
        objectIdentifier=("analogInput", 1),
        objectName="OAT",
        presentValue=60.0,
        units="degreesFahrenheit",
        covIncrement=0.5,
        description="scripted outdoor air temp (slow sine)",
    )
    app.add_object(oat)

    print(f"vctrl up: device instance {args.instance}, ZN-T + OAT drifting")
    t0 = time.time()
    while True:
        await asyncio.sleep(2.0)
        el = time.time() - t0
        # Zone: 72 +/- 4 over ~6 min, plus a fast 0.3-degree wiggle so COV
        # crossings happen every handful of seconds.
        zn.presentValue = 72.0 + 4.0 * math.sin(el / 60.0) + 0.3 * math.sin(el / 7.0)
        # OAT: 60 +/- 8 over ~30 min.
        oat.presentValue = 60.0 + 8.0 * math.sin(el / 300.0)


if __name__ == "__main__":
    asyncio.run(main())
