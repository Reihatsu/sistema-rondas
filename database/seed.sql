-- ===========================================================================
-- Sistema de Rondas - Datos de demostración
-- ---------------------------------------------------------------------------
-- Ejecutar DESPUÉS de schema.sql, sobre una base de datos vacía:
--   mysql -u root -p sistema_rondas_db < database/seed.sql
--
-- Credenciales (solo demo, cámbielas en producción):
--   admin@demo.com        -> admin123      (ADMIN)
--   supervisor@demo.com   -> super123      (SUPERVISOR)
--   guardia1@demo.com     -> guardia123    (GUARD)
--   guardia2@demo.com     -> guardia123    (GUARD)
--   cliente@demo.com      -> cliente123    (COMPANY_USER)
--
-- La empresa 1 marca sus puntos con códigos QR y la empresa 2 con etiquetas
-- NFC. En los registros de ronda, `nfc_tag_id` guarda el UID de la etiqueta
-- (empresa NFC) o el código del punto (empresa QR).
-- ===========================================================================

SET NAMES utf8mb4;

USE `sistema_rondas_db`;

-- --- Empresas --------------------------------------------------------------
INSERT IGNORE INTO `companies`
    (`id`, `name`, `tax_id`, `address`, `phone`, `point_type`, `is_active`)
VALUES
    (1, 'Empresa Demo S.A.', 'B12345678', 'Calle Mayor 10, 28013 Madrid',
     '+34 910 000 000', 'QR', 1),
    (2, 'Empresa NFC Demo S.L.', 'B87654321',
     'Avenida del Puerto 24, 46011 Valencia', '+34 960 111 222', 'NFC', 1);

-- --- Usuarios --------------------------------------------------------------
-- Hash bcrypt de las contraseñas indicadas en el encabezado.
INSERT IGNORE INTO `users` (`id`, `name`, `email`, `password_hash`, `role`, `is_active`) VALUES
    (1, 'Administrador Demo', 'admin@demo.com',
     '$2b$12$5RhWqhSlGuM5yTGyEF/fjuAf9kKOd0QfaDvogH8w1HYFcxHAZSLL6', 'ADMIN', 1),
    (2, 'Supervisora Demo', 'supervisor@demo.com',
     '$2b$12$Y/XYvBRoBSKFBgJb4O96XuPPKvgg/JYVkIAMdM3nQJvW8R3cB2lwG', 'SUPERVISOR', 1),
    (3, 'Guardia Uno', 'guardia1@demo.com',
     '$2b$12$YojQ6Fopi2XMJndH/rFFZ.p9Md..M7FHeGg0O/L/9.yETxliV7Dk2', 'GUARD', 1),
    (4, 'Guardia Dos', 'guardia2@demo.com',
     '$2b$12$YojQ6Fopi2XMJndH/rFFZ.p9Md..M7FHeGg0O/L/9.yETxliV7Dk2', 'GUARD', 1),
    (5, 'Cliente Demo', 'cliente@demo.com',
     '$2b$12$ufjeRBM5waxd8qATtQ9i/uLPSNkDcTZMgqW27eMlnR6HLg9JDKAfa', 'COMPANY_USER', 1);

-- --- Empresas por usuario --------------------------------------------------
INSERT IGNORE INTO `user_companies` (`user_id`, `company_id`) VALUES
    (2, 1), (2, 2),
    (3, 1), (3, 2),
    (4, 1), (4, 2),
    (5, 1), (5, 2);

-- --- Guardias asignados a la supervisora ----------------------------------
INSERT IGNORE INTO `supervisor_guards` (`supervisor_id`, `guard_id`) VALUES
    (2, 3),
    (2, 4);

-- --- Puntos de control QR (empresa 1) -------------------------------------
INSERT IGNORE INTO `checkpoints`
    (`id`, `company_id`, `name`, `code`, `uid_nfc`, `location_description`,
     `latitude`, `longitude`, `geofence_radius_m`, `is_active`)
VALUES
    (1, 1, 'Recepción', 'QR-EMP1-PT01', NULL,
     'Mostrador de recepción, junto al acceso peatonal principal.',
     40.415462, -3.709687, 50, 1),
    (2, 1, 'Estacionamiento Nivel -1', 'QR-EMP1-PT02', NULL,
     'Columna central del nivel -1, frente a la rampa vehicular.',
     40.415100, -3.710150, 50, 1),
    (3, 1, 'Bodega Principal', 'QR-EMP1-PT03', NULL,
     'Puerta de acceso a la bodega principal, sector de carga.',
     40.414700, -3.709500, 50, 1),
    (4, 2, 'Portal Marítimo', 'NFC-EMP2-PT01', '0439D3A2064F80',
     'Torno peatonal del portal marítimo, junto al control de accesos.',
     39.464100, -0.331500, 50, 1),
    (5, 2, 'Muelle de Carga', 'NFC-EMP2-PT02', '04B830A2064F80',
     'Etiqueta adherida a la columna 4 del muelle de carga, sector norte.',
     39.463400, -0.330900, 40, 1),
    (6, 2, 'Cuarto de Máquinas', 'NFC-EMP2-PT03', '0491D8A2064F80',
     'Puerta del cuarto de máquinas, nivel sótano del edificio técnico.',
     39.464900, -0.332100, 30, 1);

-- Las etiquetas NFC demo usan ahora los UID físicos reales. Si una base creada
-- con un seed anterior conserva los UID ficticios, se actualizan aquí; un UID
-- cargado manualmente desde la aplicación no se toca.
UPDATE `checkpoints` SET `uid_nfc` = '0439D3A2064F80'
WHERE `code` = 'NFC-EMP2-PT01' AND `uid_nfc` = '04A23B4C5D6E80';
UPDATE `checkpoints` SET `uid_nfc` = '04B830A2064F80'
WHERE `code` = 'NFC-EMP2-PT02' AND `uid_nfc` = '04B34C5D6E7F91';
UPDATE `checkpoints` SET `uid_nfc` = '0491D8A2064F80'
WHERE `code` = 'NFC-EMP2-PT03' AND `uid_nfc` = '04C45D6E7F80A2';


-- --- Rondas ----------------------------------------------------------------
-- ``last_activity_at`` alimenta el plazo de inactividad de 20 minutos y
-- ``paused_at``/``paused_seconds`` permiten reanudar el cronómetro.
INSERT IGNORE INTO `rounds`
    (`id`, `company_id`, `guard_id`, `status`, `start_time`, `end_time`,
     `paused_at`, `paused_seconds`, `last_activity_at`, `cancel_reason`,
     `observations`, `created_at`)
VALUES
    (1, 1, 3, 'IN_PROGRESS',
     DATE_SUB(NOW(), INTERVAL 8 MINUTE), NULL,
     NULL, 0, DATE_SUB(NOW(), INTERVAL 3 MINUTE), NULL,
     'Ronda en curso: recorrido de los puntos de control del perímetro. Permite probar el cronómetro, el escaneo QR y las pausas.',
     DATE_SUB(NOW(), INTERVAL 8 MINUTE)),
    (2, 1, 3, 'COMPLETED',
     DATE_SUB(NOW(), INTERVAL 180 MINUTE), DATE_SUB(NOW(), INTERVAL 150 MINUTE),
     NULL, 300, DATE_SUB(NOW(), INTERVAL 150 MINUTE), NULL,
     'Ronda completada sin incidencias; todos los checkpoints fueron leídos.',
     DATE_SUB(NOW(), INTERVAL 180 MINUTE)),
    (3, 1, 4, 'PAUSED',
     DATE_SUB(NOW(), INTERVAL 60 MINUTE), NULL,
     DATE_SUB(NOW(), INTERVAL 15 MINUTE), 600,
     DATE_SUB(NOW(), INTERVAL 15 MINUTE), NULL,
     'Ronda pausada por una alerta en el sector B; pendiente de reanudar.',
     DATE_SUB(NOW(), INTERVAL 60 MINUTE)),
    (4, 1, 3, 'CANCELLED',
     DATE_SUB(NOW(), INTERVAL 300 MINUTE), DATE_SUB(NOW(), INTERVAL 285 MINUTE),
     NULL, 0, DATE_SUB(NOW(), INTERVAL 285 MINUTE),
     'Mantenimiento programado en el edificio',
     'Ronda cancelada por el cliente debido a un mantenimiento programado.',
     DATE_SUB(NOW(), INTERVAL 300 MINUTE)),
    (5, 2, 4, 'COMPLETED',
     DATE_SUB(NOW(), INTERVAL 95 MINUTE), DATE_SUB(NOW(), INTERVAL 80 MINUTE),
     NULL, 0, DATE_SUB(NOW(), INTERVAL 80 MINUTE), NULL,
     'Ronda NFC completada: etiquetas leídas sin conexión y sincronizadas al recuperar la señal.',
     DATE_SUB(NOW(), INTERVAL 95 MINUTE));

-- --- Marcaciones de las rondas (QR y NFC) ---------------------------------
INSERT INTO `round_logs`
    (`round_id`, `checkpoint_id`, `nfc_tag_id`, `checkpoint_name`,
     `elapsed_seconds`, `timestamp`, `status`)
VALUES
    (1, 1, 'QR-EMP1-PT01', 'Recepción',
     120, DATE_SUB(NOW(), INTERVAL 6 MINUTE), 'OK'),
    (2, 1, 'QR-EMP1-PT01', 'Recepción',
     300, DATE_SUB(NOW(), INTERVAL 174 MINUTE), 'OK'),
    (2, 2, 'QR-EMP1-PT02', 'Estacionamiento Nivel -1',
     780, DATE_SUB(NOW(), INTERVAL 166 MINUTE), 'OK'),
    (2, 3, 'QR-EMP1-PT03', 'Bodega Principal',
     1400, DATE_SUB(NOW(), INTERVAL 156 MINUTE), 'OK'),
    (3, 1, 'QR-EMP1-PT01', 'Recepción',
     240, DATE_SUB(NOW(), INTERVAL 55 MINUTE), 'OK'),
    (3, 2, 'QR-EMP1-PT02', 'Estacionamiento Nivel -1',
     1500, DATE_SUB(NOW(), INTERVAL 32 MINUTE), 'OK'),
    (5, 4, '0439D3A2064F80', 'Portal Marítimo',
     180, DATE_SUB(NOW(), INTERVAL 92 MINUTE), 'OK'),
    (5, 5, '04B830A2064F80', 'Muelle de Carga',
     480, DATE_SUB(NOW(), INTERVAL 87 MINUTE), 'OK'),
    (5, 6, '0491D8A2064F80', 'Cuarto de Máquinas',
     780, DATE_SUB(NOW(), INTERVAL 82 MINUTE), 'OK');
