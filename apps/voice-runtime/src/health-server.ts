import { createServer, type Server } from "node:http";

/**
 * Container liveness/readiness for Fargate (docs/13 backlog item 9: "Blue/
 * green deploy support: graceful drain on shutdown signal, readiness gate
 * that only accepts new calls when fully healthy"). `/healthz` is always
 * 200 once the process is up; `/readyz` reflects whether this worker
 * should currently receive new call dispatches — flipped false during
 * SIGTERM drain so the load balancer stops routing new calls here while
 * in-flight calls finish, without killing the process.
 */
export class HealthServer {
  private server: Server | undefined;
  private ready = false;

  setReady(ready: boolean): void {
    this.ready = ready;
  }

  start(port: number): Promise<void> {
    return new Promise((resolve) => {
      this.server = createServer((req, res) => {
        if (req.url === "/healthz") {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("ok");
          return;
        }
        if (req.url === "/readyz") {
          res.writeHead(this.ready ? 200 : 503, { "Content-Type": "text/plain" });
          res.end(this.ready ? "ready" : "draining");
          return;
        }
        res.writeHead(404);
        res.end();
      });
      this.server.listen(port, "0.0.0.0", () => resolve());
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}
