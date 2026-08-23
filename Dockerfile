# build the Rust server
FROM rust:1-slim AS build
WORKDIR /app
COPY server/Cargo.toml ./
COPY server/src ./src
RUN cargo build --release

# runtime: server + static client files
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/target/release/thump-server /usr/local/bin/thump-server
COPY index.html style.css core.js app.js manifest.json sw.js icon-192.png icon-512.png /srv/thump/
WORKDIR /srv/thump
EXPOSE 3000
ENV DATABASE_URL=host=db user=thump password=thump dbname=thump
CMD ["thump-server", "/srv/thump"]
