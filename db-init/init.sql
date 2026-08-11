CREATE TABLE IF NOT EXISTS workers (
    card_id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100),
    surname VARCHAR(100),
    status VARCHAR(20) DEFAULT 'ACTIVE'
);

CREATE TABLE IF NOT EXISTS attendance_logs (
    id SERIAL PRIMARY KEY,
    card_id VARCHAR(50),
    direction VARCHAR(10), -- IN or OUT
    device_serial VARCHAR(50),
    ip_address VARCHAR(45),
    firmware VARCHAR(10),
    scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP + INTERVAL '3 hours'
);

CREATE TABLE IF NOT EXISTS admin_users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP + INTERVAL '3 hours'
);

-- Seed default admin account (adnan / mutlu)
INSERT INTO admin_users (username, password_hash) VALUES 
('adnan', 'a3a0071b4591334a8c549d1bd451cf4f4f407cc49b5120c60ccf35ffcea88130')
ON CONFLICT (username) DO NOTHING;

-- Seed test workers
INSERT INTO workers (card_id, name, surname) VALUES 
('46111307', 'Adnan', 'Mutlu'),
('5E6F7G8H', 'Jane', 'Smith')
ON CONFLICT DO NOTHING;