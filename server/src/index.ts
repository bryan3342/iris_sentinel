export default {
  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname === "/health" && request.method === "GET") {
      return Response.json({ status: "ok", service: "iris-server" });
    }
    return Response.json({ error: "Not found" }, { status: 404 });
  },
};
