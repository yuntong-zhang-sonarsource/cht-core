FROM alpine:3.20

RUN apk add --update --no-cache curl

COPY cmd.sh /
RUN chmod +x /cmd.sh

CMD ["/cmd.sh"]
