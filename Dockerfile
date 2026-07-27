# Build Stage
FROM golang:1.25-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download && go mod verify

COPY . .

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -o main .


# Runtime Stage
FROM alpine:latest

WORKDIR /app

RUN apk add --no-cache ca-certificates

COPY --from=builder /app/main .

# Provide at runtime:
#   TURSO_DB_URL  e.g. libsql://….turso.io
#   TURSO_TOKEN   Turso auth token
# Optional:
#   PUBLIC_BASE_URL  e.g. https://tools.mausamgiri.in
#   PORT

EXPOSE 8080

CMD ["./main"]
