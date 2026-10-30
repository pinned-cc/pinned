# Build on the machine's own platform and cross compile, which is much faster
# than emulating arm64. The builder is pinned by Go version and digest
# (golang:1.27.3-alpine, multi platform index, looked up 2026-10-30); bump
# tag and digest together, and keep the go line in go.mod on the same Go.
# Dependabot proposes the bumps.
FROM --platform=$BUILDPLATFORM golang:1.27.3-alpine@sha256:d200d2dd76b03a99b52651fd1325aff7dcd35422c35c01bac56571b0507f3deb AS build
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
