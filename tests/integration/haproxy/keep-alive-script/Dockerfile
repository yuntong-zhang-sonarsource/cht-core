FROM alpine:3.19 AS base_build

RUN apk add --update --no-cache \
  build-base \
  curl

COPY cmd.sh /
RUN chmod +x /cmd.sh

ENTRYPOINT ["/cmd.sh"]
