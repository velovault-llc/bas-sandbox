"""
Minimal conformant BACnet client — the YABE bypass (BACpypes3).

One shot: discover devices, read the virtual controller's ZN-T, then hold
a COV subscription and print every notification as it lands.

  python vclient.py --name BAS-CLIENT --instance 9100 --address <my-ip>/24 \
      --device-address 192.168.1.165 --seconds 90

Part of tools/real-bacnet-rig — see README there.
"""

import argparse
import asyncio

from bacpypes3.argparse import SimpleArgumentParser
from bacpypes3.app import Application
from bacpypes3.pdu import Address
from bacpypes3.primitivedata import ObjectIdentifier


async def main() -> None:
    parser = SimpleArgumentParser()
    parser.add_argument("--device-address", default="192.168.1.165")
    parser.add_argument("--seconds", type=int, default=90)
    args = parser.parse_args()
    app = Application.from_args(args)

    print("who-Is...")
    i_ams = await app.who_is()
    for ia in i_ams:
        print(f"  i-Am: {ia.iAmDeviceIdentifier} from {ia.pduSource}")

    addr = Address(args.device_address)
    znt = ObjectIdentifier("analog-input,0")

    val = await app.read_property(addr, znt, "present-value")
    print(f"read ZN-T = {val}")

    print(f"subscribing COV for {args.seconds}s ...")
    try:
        async with app.change_of_value(
            addr,
            znt,
            subscriber_process_identifier=1,
            issue_confirmed_notifications=False,
            lifetime=120,
        ) as scm:
            loop = asyncio.get_event_loop()
            end = loop.time() + args.seconds
            while loop.time() < end:
                remaining = end - loop.time()
                try:
                    prop_id, prop_val = await asyncio.wait_for(
                        scm.get_value(), timeout=remaining
                    )
                    print(f"  COV: {prop_id} = {prop_val}")
                except asyncio.TimeoutError:
                    break
    except Exception as err:
        print(f"COV failed: {err!r}")

    print("done.")


if __name__ == "__main__":
    asyncio.run(main())
