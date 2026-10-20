export default function ping(req, res) {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ ok: true, url: req.url, node: process.version }));
}
