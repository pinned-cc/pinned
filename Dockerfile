# Build on the machine's own platform and cross compile, which is much faster
# than emulating arm64. The builder is pinned by digest (golang:1.27-alpine,
# multi platform index, looked up 2026-10-13); bump tag and digest together.
FROM --platform=$BUILDPLATFORM golang:1.27-alpine@sha256:f92b6ef800e499660581efdabdf25d9d817a9d124eaf900924f0504e7e27e12d AS build
RUN apk add --no-cache ca-certificates tzdata zip
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ARG TARGETOS
ARG TARGETARCH
ARG VERSION=dev
# The browser extension zip is packed into web/extras before the build embeds it.
RUN if [ -x tools/pack-extension.sh ]; then tools/pack-extension.sh; fi
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags "-s -w -X main.version=$VERSION" -o /out/pinned ./cmd/pinned
RUN mkdir -p /out/data

FROM scratch
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=build /out/pinned /pinned
COPY --from=build --chown=1000:1000 /out/data /data
ENV DATA_DIR=/data PORT=8080 TZ=UTC
USER 1000:1000
EXPOSE 8080
VOLUME /data
# scratch has no shell and no curl: the binary checks its own /health.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["/pinned", "-healthcheck"]
ENTRYPOINT ["/pinned"]
