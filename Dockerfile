FROM denoland/deno:2.7.1

WORKDIR /app

COPY deno.json .
COPY . .

# Cache deps as root so deno.lock can be written if needed
RUN deno cache main.ts

USER deno

CMD ["task", "start"]

EXPOSE 8000
