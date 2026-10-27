-- ===========================================================================
-- Sistema de Rondas - Esquema de base de datos (MySQL 8+)
-- ---------------------------------------------------------------------------
-- Este script es equivalente al esquema generado por Alembic
-- (backend/alembic/versions/0001_initial_schema.py a 0006_nullable_checkpoint_fields.py)
-- y por los modelos SQLAlchemy. Úselo solo si prefiere inicializar la base de
-- datos por SQL.
--
-- Cada empresa define el tipo de sus puntos de control (``point_type``): QR con
-- código impreso o NFC con etiqueta física. El UID de la etiqueta se guarda en
-- ``checkpoints.uid_nfc`` (hex en mayúsculas, sin separadores) y es único.
--
-- Uso (CLI):
--   mysql -u root -p < database/schema.sql
--
-- Uso en DBeaver:
--   1. Conéctese al servidor MySQL.
--   2. Abra este archivo (File > Open File).
--   3. Ejecute el script completo (Alt+X o "Execute SQL script").
--   4. Refresque el esquema: Database Navigator > F5.
--
-- Datos de demostración (opcional, tras crear el esquema):
--   mysql -u root -p sistema_rondas_db < database/seed.sql
--   o bien, desde backend/:  python init_db.py
-- ===========================================================================

SET NAMES utf8mb4;

CREATE DATABASE IF NOT EXISTS `sistema_rondas_db`
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE `sistema_rondas_db`;

-- ---------------------------------------------------------------------------
-- Empresas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `companies` (
    `id`         INT          NOT NULL AUTO_INCREMENT,
    `name`       VARCHAR(150) NOT NULL,
    `tax_id`     VARCHAR(30)  NOT NULL,
    `address`    VARCHAR(255) NULL,
    `phone`      VARCHAR(30)  NULL,
    `point_type` ENUM('QR', 'NFC') NOT NULL DEFAULT 'QR',
    `is_active`  TINYINT(1)   NOT NULL DEFAULT 1,
    `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_companies_name` (`name`),
    UNIQUE KEY `uq_companies_tax_id` (`tax_id`),
    KEY `ix_companies_is_active` (`is_active`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Usuarios
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
    `id`            INT          NOT NULL AUTO_INCREMENT,
    `name`          VARCHAR(150) NOT NULL,
    `email`         VARCHAR(150) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `role` ENUM('ADMIN', 'SUPERVISOR', 'COMPANY_USER', 'GUARD')
                    NOT NULL DEFAULT 'GUARD',
    `is_active`     TINYINT(1)   NOT NULL DEFAULT 1,
    `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_users_email` (`email`),
    KEY `ix_users_role` (`role`),
    KEY `ix_users_is_active` (`is_active`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Empresas asignadas a cada usuario (muchos-a-muchos)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `user_companies` (
    `user_id`    INT      NOT NULL,
    `company_id` INT      NOT NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`user_id`, `company_id`),
    KEY `ix_user_companies_company_id` (`company_id`),
    CONSTRAINT `fk_user_companies_user_id_users`
        FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_user_companies_company_id_companies`
        FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Asociación Supervisor -> Guardia (ambos son usuarios)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `supervisor_guards` (
    `supervisor_id` INT      NOT NULL,
    `guard_id`      INT      NOT NULL,
    `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`supervisor_id`, `guard_id`),
    KEY `ix_supervisor_guards_guard_id` (`guard_id`),
    CONSTRAINT `fk_supervisor_guards_supervisor_id_users`
        FOREIGN KEY (`supervisor_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_supervisor_guards_guard_id_users`
        FOREIGN KEY (`guard_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Puntos de control configurables (QR/NFC)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `checkpoints` (
    `id`                   INT          NOT NULL AUTO_INCREMENT,
    `company_id`           INT          NOT NULL,
    `name`                 VARCHAR(150) NOT NULL,
    `code`                 VARCHAR(100) NOT NULL,
    `uid_nfc`              VARCHAR(100) NULL,
    `location_description` TEXT         NULL,
    `latitude`             FLOAT        NULL,
    `longitude`            FLOAT        NULL,
    `geofence_radius_m`    INT          NOT NULL DEFAULT 50,
    `is_active`            TINYINT(1)   NOT NULL DEFAULT 1,
    `created_at`           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_checkpoints_code` (`code`),
    UNIQUE KEY `uq_checkpoints_uid_nfc` (`uid_nfc`),
    KEY `ix_checkpoints_company_id` (`company_id`),
    KEY `ix_checkpoints_is_active` (`is_active`),
    KEY `ix_checkpoints_uid_nfc` (`uid_nfc`),
    CONSTRAINT `fk_checkpoints_company_id_companies`
        FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Rondas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `rounds` (
    `id`           INT      NOT NULL AUTO_INCREMENT,
    `company_id`   INT      NOT NULL,
    `guard_id`     INT      NOT NULL,
    `status` ENUM('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'PAUSED')
                    NOT NULL DEFAULT 'PENDING',
    `start_time`   DATETIME NULL,
    `end_time`     DATETIME NULL,
    `paused_at`    DATETIME NULL,
    `paused_seconds` INT    NOT NULL DEFAULT 0,
    `last_activity_at` DATETIME NULL,
    `cancel_reason` VARCHAR(255) NULL,
    `observations` TEXT     NULL,
    `created_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `ix_rounds_company_id` (`company_id`),
    KEY `ix_rounds_guard_id` (`guard_id`),
    KEY `ix_rounds_status` (`status`),
    KEY `ix_rounds_last_activity_at` (`last_activity_at`),
    KEY `ix_rounds_created_at` (`created_at`),
    CONSTRAINT `fk_rounds_company_id_companies`
        FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_rounds_guard_id_users`
        FOREIGN KEY (`guard_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Checkpoints (NFC/QR) de cada ronda
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `round_logs` (
    `id`              INT          NOT NULL AUTO_INCREMENT,
    `round_id`        INT          NOT NULL,
    `checkpoint_id`   INT          NULL,
    `nfc_tag_id`      VARCHAR(100) NOT NULL,
    `checkpoint_name` VARCHAR(150) NOT NULL,
    `latitude`        FLOAT        NULL,
    `longitude`       FLOAT        NULL,
    `distance_m`      FLOAT        NULL,
    `elapsed_seconds` INT          NULL,
    `timestamp`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `status` ENUM('OK', 'INCIDENT', 'SKIPPED') NOT NULL DEFAULT 'OK',
    PRIMARY KEY (`id`),
    KEY `ix_round_logs_round_id` (`round_id`),
    KEY `ix_round_logs_checkpoint_id` (`checkpoint_id`),
    KEY `ix_round_logs_nfc_tag_id` (`nfc_tag_id`),
    KEY `ix_round_logs_timestamp` (`timestamp`),
    CONSTRAINT `fk_round_logs_round_id_rounds`
        FOREIGN KEY (`round_id`) REFERENCES `rounds` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_round_logs_checkpoint_id_checkpoints`
        FOREIGN KEY (`checkpoint_id`) REFERENCES `checkpoints` (`id`) ON DELETE SET NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Verificación rápida (ejecutar manualmente si se desea)
-- ---------------------------------------------------------------------------
-- SHOW TABLES;
-- SELECT COUNT(*) FROM information_schema.tables
--  WHERE table_schema = 'sistema_rondas_db';

