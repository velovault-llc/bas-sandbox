# BACnet Stack reference device — open-source bacnet-stack project
# (https://github.com/bacnet-stack/bacnet-stack) compiled and run as
# a tiny BACnet device on UDP 47808. We use it as a ground-truth peer
# for the sandbox: real wire bytes from a published BACnet stack to
# compare our sim's behavior against.
#
# Usage:
#   docker build -t bas-bacnet-ref tools/bacnet-reference/
#   docker run --rm --network host bas-bacnet-ref
# Then point YABE / Wireshark at UDP 47808 on the host to see real
# Who-Is / I-Am / ReadProperty traffic.

FROM debian:bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential \
      git \
      ca-certificates \
      pkg-config \
      libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Pin to a known-good tag. The bacnet-stack maintainers tag stable
# releases; bump this date when refreshing.
ARG BACNET_STACK_REF=bacnet-stack-1.3.7
RUN git clone --depth 1 --branch ${BACNET_STACK_REF} \
      https://github.com/bacnet-stack/bacnet-stack.git /src/bacnet-stack

WORKDIR /src/bacnet-stack
# The `server` demo is the simplest reference device. Builds a binary
# that listens on UDP 47808 and answers Who-Is / ReadProperty etc.
RUN make BACNET_PORT=bsd
RUN cp bin/bacserv /usr/local/bin/bacserv

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      libc6 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /usr/local/bin/bacserv /usr/local/bin/bacserv

# Device instance defaults to 1234. Override at runtime via:
#   docker run -e BACNET_DEVICE_ID=4242 ...
ENV BACNET_DEVICE_ID=1234

EXPOSE 47808/udp
CMD ["sh", "-c", "exec bacserv $BACNET_DEVICE_ID"]
