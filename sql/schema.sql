-- =====================================================
-- Project Akhir : FindBack (Website Pencarian Barang Hilang)
-- Database      : PostgreSQL
-- Deskripsi     : Struktur database untuk melaporkan, mencari,
--                 dan menemukan kembali barang yang hilang.
-- =====================================================

DROP TABLE IF EXISTS item_tags      CASCADE;
DROP TABLE IF EXISTS claims         CASCADE;
DROP TABLE IF EXISTS item_images    CASCADE;
DROP TABLE IF EXISTS tags           CASCADE;
DROP TABLE IF EXISTS items          CASCADE;
DROP TABLE IF EXISTS locations      CASCADE;
DROP TABLE IF EXISTS categories     CASCADE;
DROP TABLE IF EXISTS user_profiles  CASCADE;
DROP TABLE IF EXISTS users          CASCADE;

DROP TYPE IF EXISTS item_type;
DROP TYPE IF EXISTS item_status;
DROP TYPE IF EXISTS claim_status;

CREATE TYPE item_type    AS ENUM ('lost', 'found');
CREATE TYPE item_status  AS ENUM ('open', 'claimed', 'returned', 'closed');
CREATE TYPE claim_status AS ENUM ('pending', 'approved', 'rejected');

-- 1. USERS : akun pengguna aplikasi
CREATE TABLE users (
    user_id     SERIAL PRIMARY KEY,
    username    VARCHAR(50)  NOT NULL UNIQUE,
    email       VARCHAR(100) NOT NULL UNIQUE,
    password    VARCHAR(255) NOT NULL,
    role        VARCHAR(10)  NOT NULL DEFAULT 'user'
                CHECK (role IN ('user', 'admin')),
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. USER_PROFILES : detail profil pengguna
--    Relasi 1:1 dengan users (user_id bersifat UNIQUE)
CREATE TABLE user_profiles (
    profile_id  SERIAL PRIMARY KEY,
    user_id     INT NOT NULL UNIQUE
                REFERENCES users(user_id) ON DELETE CASCADE,
    full_name   VARCHAR(100) NOT NULL,
    phone       VARCHAR(20),
    address     TEXT,
    avatar_url  VARCHAR(255)
);

-- 3. CATEGORIES : kategori barang (dompet, HP, kunci, dll)
CREATE TABLE categories (
    category_id   SERIAL PRIMARY KEY,
    category_name VARCHAR(50) NOT NULL UNIQUE,
    description   TEXT
);

-- 4. LOCATIONS : lokasi kehilangan / penemuan barang
CREATE TABLE locations (
    location_id   SERIAL PRIMARY KEY,
    location_name VARCHAR(100) NOT NULL,
    city          VARCHAR(50)  NOT NULL,
    address       TEXT,
    latitude      NUMERIC(9,6),
    longitude     NUMERIC(9,6)
);

-- 5. ITEMS : laporan barang hilang / ditemukan
--    Relasi 1:N : users -> items, categories -> items, locations -> items
CREATE TABLE items (
    item_id      SERIAL PRIMARY KEY,
    user_id      INT NOT NULL REFERENCES users(user_id)           ON DELETE CASCADE,
    category_id  INT NOT NULL REFERENCES categories(category_id)  ON DELETE RESTRICT,
    location_id  INT NOT NULL REFERENCES locations(location_id)   ON DELETE RESTRICT,
    type         item_type   NOT NULL,
    title        VARCHAR(150) NOT NULL,
    description  TEXT,
    event_date   DATE        NOT NULL,
    status       item_status NOT NULL DEFAULT 'open',
    created_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 6. ITEM_IMAGES : foto barang
--    Relasi 1:N : items -> item_images
CREATE TABLE item_images (
    image_id    SERIAL PRIMARY KEY,
    item_id     INT NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
    image_url   VARCHAR(255) NOT NULL,
    is_primary  BOOLEAN NOT NULL DEFAULT FALSE,
    uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 7. CLAIMS : klaim kepemilikan atas barang yang ditemukan
--    Relasi 1:N : items -> claims, users -> claims
CREATE TABLE claims (
    claim_id       SERIAL PRIMARY KEY,
    item_id        INT NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
    claimer_id     INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    proof_desc     TEXT NOT NULL,
    status         claim_status NOT NULL DEFAULT 'pending',
    claimed_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (item_id, claimer_id)
);

-- 8. TAGS : label pencarian (mis. "biru", "iPhone", "kulit")
CREATE TABLE tags (
    tag_id   SERIAL PRIMARY KEY,
    tag_name VARCHAR(30) NOT NULL UNIQUE
);

-- 9. ITEM_TAGS : tabel penghubung
--    Relasi N:N : items <-> tags
CREATE TABLE item_tags (
    item_id INT NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
    tag_id  INT NOT NULL REFERENCES tags(tag_id)   ON DELETE CASCADE,
    PRIMARY KEY (item_id, tag_id)
);

-- INDEX untuk mempercepat pencarian
CREATE INDEX idx_items_type_status ON items(type, status);
CREATE INDEX idx_items_category    ON items(category_id);
CREATE INDEX idx_items_location    ON items(location_id);
CREATE INDEX idx_claims_item       ON claims(item_id);

-- =====================================================
-- DATA CONTOH (opsional, untuk pengujian)
-- =====================================================
INSERT INTO users (username, email, password, role) VALUES
('budi',  'budi@mail.com',  'hashed_pw_1', 'user'),
('sari',  'sari@mail.com',  'hashed_pw_2', 'user'),
('admin', 'admin@findback.id', 'hashed_pw_3', 'admin');

INSERT INTO user_profiles (user_id, full_name, phone, address) VALUES
(1, 'Budi Santoso', '081234567890', 'Yogyakarta'),
(2, 'Sari Wulandari', '082345678901', 'Sleman');

INSERT INTO categories (category_name, description) VALUES
('Dompet', 'Dompet dan tempat kartu'),
('Elektronik', 'HP, laptop, earphone, dll'),
('Kunci', 'Kunci motor, mobil, rumah');

INSERT INTO locations (location_name, city, address) VALUES
('Stasiun Tugu', 'Yogyakarta', 'Jl. Pangeran Mangkubumi'),
('Malioboro', 'Yogyakarta', 'Jl. Malioboro');

INSERT INTO items (user_id, category_id, location_id, type, title, description, event_date) VALUES
(1, 1, 1, 'lost',  'Dompet kulit coklat', 'Hilang di peron stasiun, berisi KTP dan ATM', '2026-10-01'),
(2, 2, 2, 'found', 'Earphone putih',      'Ditemukan di bangku depan toko',               '2026-10-02');

INSERT INTO item_images (item_id, image_url, is_primary) VALUES
(1, 'uploads/dompet1.jpg', TRUE),
(2, 'uploads/earphone1.jpg', TRUE);

INSERT INTO claims (item_id, claimer_id, proof_desc) VALUES
(2, 1, 'Earphone ini milik saya, ada goresan di case bagian bawah');

INSERT INTO tags (tag_name) VALUES ('coklat'), ('kulit'), ('putih'), ('wireless');

INSERT INTO item_tags (item_id, tag_id) VALUES
(1, 1), (1, 2), (2, 3), (2, 4);
