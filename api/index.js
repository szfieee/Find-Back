const { Pool } = require("pg");

let pool;
function getPool() {
  if (!process.env.DATABASE_URL) {
    const err = new Error("Environment variable DATABASE_URL belum diatur");
    err.status = 500;
    throw err;
  }
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes("localhost")
        ? false
        : { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000
    });
  }
  return pool;
}

const send = (res, status, body) => res.status(status).json(body);
const asyncHandler = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    console.error(e);
    if (e.code === "23505") return send(res, 409, { error: "Data duplikat atau sudah ada" });
    if (e.code === "23503") return send(res, 400, { error: "Referensi user, kategori, lokasi, atau barang tidak valid" });
    if (e.code === "22P02" || e.code === "22007" || e.code === "23514")
      return send(res, 400, { error: "Format input tidak valid" });
    return send(res, e.status || 500, { error: e.status ? e.message : "Terjadi kesalahan pada server" });
  });

const parseId = (value) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};
const itemSelect = `
 SELECT i.item_id, i.user_id, u.username, i.category_id, c.category_name,
        i.location_id, l.location_name, l.city, i.type, i.title, i.description,
        i.event_date, i.status, i.created_at,
        COALESCE((SELECT json_agg(json_build_object('image_id', im.image_id,
          'image_url', im.image_url, 'is_primary', im.is_primary)
          ORDER BY im.is_primary DESC, im.image_id)
          FROM item_images im WHERE im.item_id=i.item_id), '[]'::json) AS images,
        COALESCE((SELECT json_agg(t.tag_name ORDER BY t.tag_name)
          FROM item_tags it JOIN tags t ON t.tag_id=it.tag_id
          WHERE it.item_id=i.item_id), '[]'::json) AS tags
 FROM items i JOIN users u ON u.user_id=i.user_id
 JOIN categories c ON c.category_id=i.category_id
 JOIN locations l ON l.location_id=i.location_id`;

module.exports = asyncHandler(async (req, res) => {
  const method = req.method.toUpperCase();
  const url = new URL(req.url, "http://localhost");
  const parts = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  // Vercel rewrite maps requests to /api; preserve the requested route when available.
  const route = parts[0] === "api" ? parts.slice(1) : parts;
  const resource = route[0] || "";
  const id = route[1] ? parseId(route[1]) : null;

  // Root endpoint is useful when opening the deployment URL in a browser.
  if (method === "GET" && !resource)
    return send(res, 200, {
      message: "FindBack API aktif",
      status: "ok",
      endpoints: ["/health", "/db-health", "/items", "/categories", "/locations", "/tags"]
    });

  // Liveness check does not require a database connection.
  if (method === "GET" && resource === "health") {
    // Optional DB probe on the stable health route avoids rewrite/path edge cases.
    if (url.searchParams.get("db") === "1") {
      const db = getPool();
      await db.query("SELECT 1");
      return send(res, 200, { message: "Koneksi database berhasil", status: "ok" });
    }
    return send(res, 200, { message: "FindBack API aktif", status: "ok" });
  }

  // Separate database check so connection/schema errors are easier to identify.
  if (method === "GET" && resource === "db-health") {
    const db = getPool();
    await db.query("SELECT 1");
    return send(res, 200, { message: "Koneksi database berhasil", status: "ok" });
  }

  const db = getPool();

  if (resource === "items") {
    if (method === "GET" && !route[1]) {
      const values = [], where = [];
      const add = (sql, value) => { values.push(value); where.push(sql.replace("?", `$${values.length}`)); };
      const type = url.searchParams.get("type");
      const status = url.searchParams.get("status");
      const categoryId = url.searchParams.get("category_id");
      const q = url.searchParams.get("q");
      if (type) {
        if (!["lost", "found"].includes(type)) return send(res, 400, { error: "type harus lost atau found" });
        add("i.type = ?", type);
      }
      if (status) {
        if (!["open", "claimed", "returned", "closed"].includes(status)) return send(res, 400, { error: "status tidak valid" });
        add("i.status = ?", status);
      }
      if (categoryId) {
        if (!parseId(categoryId)) return send(res, 400, { error: "category_id harus berupa bilangan positif" });
        add("i.category_id = ?", Number(categoryId));
      }
      if (q) add("(i.title ILIKE ? OR COALESCE(i.description,'') ILIKE ? OR EXISTS (SELECT 1 FROM item_tags it JOIN tags t ON t.tag_id=it.tag_id WHERE it.item_id=i.item_id AND t.tag_name ILIKE ?))", `%${q}%`);
      // Search uses three placeholders for a single keyword.
      let sql = itemSelect;
      if (q) {
        const idx = values.length;
        values.splice(idx - 1, 1, `%${q}%`, `%${q}%`, `%${q}%`);
        where[where.length - 1] = `(i.title ILIKE $${idx} OR COALESCE(i.description,'') ILIKE $${idx+1} OR EXISTS (SELECT 1 FROM item_tags it JOIN tags t ON t.tag_id=it.tag_id WHERE it.item_id=i.item_id AND t.tag_name ILIKE $${idx+2}))`;
      }
      if (where.length) sql += " WHERE " + where.join(" AND ");
      sql += " ORDER BY i.created_at DESC";
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 100);
      values.push(limit);
      sql += ` LIMIT $${values.length}`;
      const result = await db.query(sql, values);
      return send(res, 200, { data: result.rows, count: result.rowCount });
    }

    if (method === "GET" && route[1]) {
      if (!id) return send(res, 400, { error: "ID barang tidak valid" });
      const r = await db.query(`${itemSelect} WHERE i.item_id=$1`, [id]);
      return r.rowCount ? send(res, 200, { data: r.rows[0] }) : send(res, 404, { error: "Barang tidak ditemukan" });
    }

    if (method === "POST" && !route[1]) {
      const { user_id, category_id, location_id, type, title, description = null, event_date, status = "open", tags = [], images = [] } = req.body || {};
      if (!user_id || !category_id || !location_id || !type || !title || !event_date)
        return send(res, 400, { error: "Field user_id, category_id, location_id, type, title, dan event_date wajib diisi" });
      if (!["lost", "found"].includes(type)) return send(res, 400, { error: "type harus lost atau found" });
      if (!["open", "claimed", "returned", "closed"].includes(status)) return send(res, 400, { error: "status tidak valid" });
      if (typeof title !== "string" || title.trim().length < 2 || title.length > 150) return send(res, 400, { error: "title harus 2-150 karakter" });
      if (!Array.isArray(tags) || !Array.isArray(images)) return send(res, 400, { error: "tags dan images harus berupa array" });
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const r = await client.query(
          "INSERT INTO items(user_id,category_id,location_id,type,title,description,event_date,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING item_id",
          [user_id, category_id, location_id, type, title.trim(), description, event_date, status]);
        const itemId = r.rows[0].item_id;
        for (const tag of tags) {
          if (typeof tag !== "string" || !tag.trim()) continue;
          const tr = await client.query("INSERT INTO tags(tag_name) VALUES($1) ON CONFLICT(tag_name) DO UPDATE SET tag_name=EXCLUDED.tag_name RETURNING tag_id", [tag.trim().toLowerCase()]);
          await client.query("INSERT INTO item_tags(item_id,tag_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [itemId, tr.rows[0].tag_id]);
        }
        for (const image of images) {
          if (typeof image === "string" && image.trim())
            await client.query("INSERT INTO item_images(item_id,image_url) VALUES($1,$2)", [itemId, image.trim()]);
        }
        await client.query("COMMIT");
        const created = await db.query(`${itemSelect} WHERE i.item_id=$1`, [itemId]);
        return send(res, 201, { message: "Laporan barang berhasil ditambahkan", data: created.rows[0] });
      } catch (e) { await client.query("ROLLBACK"); throw e; }
      finally { client.release(); }
    }

    if (method === "PUT" && route[1]) {
      if (!id) return send(res, 400, { error: "ID barang tidak valid" });
      const { user_id, category_id, location_id, type, title, description = null, event_date, status } = req.body || {};
      if (!user_id || !category_id || !location_id || !type || !title || !event_date || !status)
        return send(res, 400, { error: "PUT wajib memuat user_id, category_id, location_id, type, title, event_date, dan status" });
      if (!["lost", "found"].includes(type) || !["open", "claimed", "returned", "closed"].includes(status))
        return send(res, 400, { error: "type atau status tidak valid" });
      const r = await db.query(
        `UPDATE items SET user_id=$1,category_id=$2,location_id=$3,type=$4,title=$5,description=$6,event_date=$7,status=$8 WHERE item_id=$9 RETURNING item_id`,
        [user_id, category_id, location_id, type, title, description, event_date, status, id]);
      if (!r.rowCount) return send(res, 404, { error: "Barang tidak ditemukan" });
      const updated = await db.query(`${itemSelect} WHERE i.item_id=$1`, [id]);
      return send(res, 200, { message: "Data barang berhasil diperbarui", data: updated.rows[0] });
    }

    if (method === "PATCH" && route[1]) {
      if (!id) return send(res, 400, { error: "ID barang tidak valid" });
      const allowed = ["user_id", "category_id", "location_id", "type", "title", "description", "event_date", "status"];
      const body = req.body || {};
      const keys = Object.keys(body).filter(k => allowed.includes(k));
      if (!keys.length) return send(res, 400, { error: "Minimal satu field barang yang valid harus diisi" });
      if (body.type && !["lost", "found"].includes(body.type)) return send(res, 400, { error: "type harus lost atau found" });
      if (body.status && !["open", "claimed", "returned", "closed"].includes(body.status)) return send(res, 400, { error: "status tidak valid" });
      if (body.title !== undefined && (typeof body.title !== "string" || !body.title.trim())) return send(res, 400, { error: "title tidak boleh kosong" });
      const values = keys.map(k => body[k]);
      const sets = keys.map((k, i) => `${k}=$${i+1}`);
      values.push(id);
      const r = await db.query(`UPDATE items SET ${sets.join(",")} WHERE item_id=$${values.length} RETURNING item_id`, values);
      if (!r.rowCount) return send(res, 404, { error: "Barang tidak ditemukan" });
      const updated = await db.query(`${itemSelect} WHERE i.item_id=$1`, [id]);
      return send(res, 200, { message: "Data barang berhasil diperbarui", data: updated.rows[0] });
    }

    if (method === "DELETE" && route[1]) {
      if (!id) return send(res, 400, { error: "ID barang tidak valid" });
      const r = await db.query("DELETE FROM items WHERE item_id=$1 RETURNING item_id", [id]);
      return r.rowCount ? send(res, 200, { message: "Data barang berhasil dihapus", item_id: id }) : send(res, 404, { error: "Barang tidak ditemukan" });
    }
  }

  const simpleResources = {
    categories: { table: "categories", id: "category_id", fields: ["category_name", "description"], required: ["category_name"] },
    locations: { table: "locations", id: "location_id", fields: ["location_name", "city", "address", "latitude", "longitude"], required: ["location_name", "city"] },
    tags: { table: "tags", id: "tag_id", fields: ["tag_name"], required: ["tag_name"] }
  };
  const cfg = simpleResources[resource];
  if (cfg) {
    if (method === "GET" && !route[1]) {
      const r = await db.query(`SELECT * FROM ${cfg.table} ORDER BY ${cfg.id}`);
      return send(res, 200, { data: r.rows, count: r.rowCount });
    }
    if (method === "GET" && route[1]) {
      if (!id) return send(res, 400, { error: "ID tidak valid" });
      const r = await db.query(`SELECT * FROM ${cfg.table} WHERE ${cfg.id}=$1`, [id]);
      return r.rowCount ? send(res, 200, { data: r.rows[0] }) : send(res, 404, { error: "Data tidak ditemukan" });
    }
    if (method === "POST" && !route[1]) {
      const body = req.body || {};
      const missing = cfg.required.find(k => body[k] === undefined || body[k] === null || body[k] === "");
      if (missing) return send(res, 400, { error: `Field ${missing} wajib diisi` });
      const keys = cfg.fields.filter(k => body[k] !== undefined);
      const values = keys.map(k => body[k]);
      const cols = keys.join(",");
      const params = keys.map((_, i) => `$${i+1}`).join(",");
      const r = await db.query(`INSERT INTO ${cfg.table}(${cols}) VALUES(${params}) RETURNING *`, values);
      return send(res, 201, { message: "Data berhasil ditambahkan", data: r.rows[0] });
    }
    if (method === "PUT" && route[1]) {
      if (!id) return send(res, 400, { error: "ID tidak valid" });
      const body = req.body || {};
      const missing = cfg.required.find(k => body[k] === undefined || body[k] === null || body[k] === "");
      if (missing) return send(res, 400, { error: `Field ${missing} wajib diisi` });
      const keys = cfg.fields.filter(k => body[k] !== undefined);
      const values = keys.map(k => body[k]); values.push(id);
      const r = await db.query(`UPDATE ${cfg.table} SET ${keys.map((k,i)=>`${k}=$${i+1}`).join(",")} WHERE ${cfg.id}=$${values.length} RETURNING *`, values);
      return r.rowCount ? send(res, 200, { message: "Data berhasil diperbarui", data: r.rows[0] }) : send(res, 404, { error: "Data tidak ditemukan" });
    }
    if (method === "DELETE" && route[1]) {
      if (!id) return send(res, 400, { error: "ID tidak valid" });
      const r = await db.query(`DELETE FROM ${cfg.table} WHERE ${cfg.id}=$1 RETURNING ${cfg.id}`, [id]);
      return r.rowCount ? send(res, 200, { message: "Data berhasil dihapus", id }) : send(res, 404, { error: "Data tidak ditemukan" });
    }
  }
  return send(res, 404, { error: "Endpoint tidak ditemukan" });
});
