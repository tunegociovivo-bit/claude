// Portal de subastas ficticio para el arnés de e2e del radar: página de acceso,
// lista de coches que pide un JSON a su "API" (para probar el sniffer) y control
// de sesión por cookie. Arranca en el puerto que se le pase por argumento.
import http from "node:http";

const PORT = Number(process.argv[2] || 4599);
const USER = "comprador@carshop.test";
const PASS = "Clave.1234";

const CARS = [
  { id: "C-1001", make: "BMW", model: "Serie 1", version: "118d Sport", mileage: 82000, currentBid: 14200, firstRegistration: "2019-04-01", fuelType: "Diesel", gearbox: "Manual", powerKw: 110, country: "ES", detailUrl: "/car/C-1001", imageUrl: "/img/1.jpg" },
  { id: "C-1002", make: "Audi", model: "A3", version: "35 TDI", mileage: 61000, currentBid: 19500, firstRegistration: "2021-01-01", fuelType: "Diesel", gearbox: "Automatic", powerKw: 110, country: "DE", detailUrl: "/car/C-1002", imageUrl: "/img/2.jpg" },
  { id: "C-1003", make: "Renault", model: "Clio", version: "1.5 dCi", mileage: 120000, currentBid: 6200, firstRegistration: "2018-06-01", fuelType: "Diesel", gearbox: "Manual", powerKw: 66, country: "ES", detailUrl: "/car/C-1003", imageUrl: "/img/3.jpg" },
  { id: "C-1004", make: "Tesla", model: "Model 3", version: "Long Range", mileage: 40000, currentBid: 28000, firstRegistration: "2022-03-01", fuelType: "Electric", gearbox: "Automatic", powerKw: 325, country: "NL", detailUrl: "/car/C-1004", imageUrl: "/img/4.jpg" },
];

function hasSession(req) {
  return (req.headers.cookie || "").includes("portal_session=yes");
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/login") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html lang="es"><body>
      <h1>Acceso profesionales</h1>
      <form method="POST" action="/do-login">
        <input type="text" name="username" placeholder="Usuario" autocomplete="username" />
        <input type="password" name="password" placeholder="Contraseña" autocomplete="current-password" />
        <button type="submit">Iniciar sesión</button>
      </form>
    </body></html>`);
    return;
  }

  if (url.pathname === "/do-login" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const params = new URLSearchParams(body);
      if (params.get("username") === USER && params.get("password") === PASS) {
        res.writeHead(302, { "Set-Cookie": "portal_session=yes; Path=/; HttpOnly", Location: "/vehicles" });
        res.end();
      } else {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!doctype html><html lang="es"><body><h1>Acceso profesionales</h1><p class="error">Usuario o contraseña incorrectos.</p>
          <form method="POST" action="/do-login"><input type="text" name="username" /><input type="password" name="password" /><button>Iniciar sesión</button></form></body></html>`);
      }
    });
    return;
  }

  if (url.pathname === "/vehicles") {
    if (!hasSession(req)) {
      res.writeHead(302, { Location: "/login" });
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html lang="es"><body>
      <header><a href="/logout">Cerrar sesión</a></header>
      <h1>Vehículos en subasta</h1>
      <div id="list">Cargando…</div>
      <script>
        fetch('/api/search?page=1').then(r=>r.json()).then(d=>{
          document.getElementById('list').innerHTML = d.data.items.map(c=>'<div class="car">'+c.make+' '+c.model+'</div>').join('');
          window.__loaded = true;
        });
      </script>
    </body></html>`);
    return;
  }

  if (url.pathname === "/api/search") {
    if (!hasSession(req)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: { items: CARS, total: CARS.length } }));
    return;
  }

  if (url.pathname === "/logout") {
    res.writeHead(302, { "Set-Cookie": "portal_session=; Path=/; Max-Age=0", Location: "/login" });
    res.end();
    return;
  }

  res.writeHead(404, { "Content-Type": "text/html" });
  res.end("<h1>404</h1>");
});

server.listen(PORT, () => console.log(`fake-portal on http://127.0.0.1:${PORT}`));
