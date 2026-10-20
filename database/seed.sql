-- ===========================================================================
-- Sistema de Rondas - Datos de demostración
-- ---------------------------------------------------------------------------
-- Ejecutar DESPUÉS de schema.sql, sobre una base de datos vacía:
--   mysql -u root -p sistema_rondas_db < database/seed.sql
--
-- Contraseñas (solo demo, cámbielas en producción):
--   admin@sistema-rondas.local   -> Admin123!
--   supervisor@rondas.local      -> Supervisor123!
--   guardia@rondas.local         -> Guardia123!
--   guardia2@rondas.local        -> Guardia123!
--   cliente@rondas.local         -> Cliente123!
-- ===========================================================================

USE `sistema_rondas_db`;

-- --- Empresas --------------------------------------------------------------
INSERT IGNORE INTO `companies` (`id`, `name`, `tax_id`, `address`, `phone`, `is_active`) VALUES
    (1, 'Vigilancia Norte S.A.', 'B12345678', 'Calle Mayor 120, Madrid', '+34 910 111 222', 1),
    (2, 'Torre Corporativa Delta', 'B87654321', 'Av. Diagonal 450, Barcelona', '+34 930 333 444', 1),
    (3, 'Logística Sur S.L.', 'B11223344', 'Polígono Industrial Sur, Sevilla', '+34 950 555 666', 0);

-- --- Usuarios --------------------------------------------------------------
-- Hash bcrypt de las contraseñas indicadas en el encabezado.
INSERT IGNORE INTO `users` (`id`, `name`, `email`, `password_hash`, `role`, `is_active`) VALUES
    (1, 'Administrador', 'admin@sistema-rondas.local',
     '$2b$12$ZpPzakgaff1Jt6dT8.nwK.o2AW1vqnjzRBom2.yGpHX7PhIfvpINS', 'ADMIN', 1),
    (2, 'Elena Supervisora', 'supervisor@rondas.local',
     '$2b$12$GdhYsmh7xCrO5q9K794NbOh1oQayq2.J7uoCmV5ItUdOjoFOSb7Fi', 'SUPERVISOR', 1),
    (3, 'Carlos Guardia', 'guardia@rondas.local',
     '$2b$12$yF9sR327plRUT53H1Gv.Je1AV7g5WzJdrJStDwXtU9lZnq1fARwPS', 'GUARD', 1),
    (4, 'Mario Cliente', 'cliente@rondas.local',
     '$2b$12$jG9/7Bw4XcHizVxVkr8l1ufGuUVdf8m.SX9y9I3vY6r2hMdBuVdX2', 'COMPANY_USER', 1),
    (5, 'Lucía Guardia', 'guardia2@rondas.local',
     '$2b$12$yF9sR327plRUT53H1Gv.Je1AV7g5WzJdrJStDwXtU9lZnq1fARwPS', 'GUARD', 1);

-- --- Empresas por usuario --------------------------------------------------
INSERT IGNORE INTO `user_companies` (`user_id`, `company_id`) VALUES
    (2, 1), (2, 2), (2, 3),
    (3, 1), (3, 2),
    (4, 1),
    (5, 1);

-- --- Guardias asignados a la supervisora ----------------------------------
INSERT IGNORE INTO `supervisor_guards` (`supervisor_id`, `guard_id`) VALUES
    (2, 3),
    (2, 5);

-- --- Puntos de control (QR/NFC) -------------------------------------------
INSERT IGNORE INTO `checkpoints`
    (`company_id`, `name`, `code`, `location_description`,
     `latitude`, `longitude`, `geofence_radius_m`, `is_active`)
VALUES
    (1, 'Recepción', 'QR-EMP1-PT01',
     'Mostrador de recepción, junto al acceso peatonal principal.',
     40.415462, -3.709687, 50, 1),
    (1, 'Estacionamiento Nivel -1', 'QR-EMP1-PT02',
     'Columna central del nivel -1, frente a la rampa vehicular.',
     40.415100, -3.710150, 50, 1),
    (1, 'Bodega Principal', 'QR-EMP1-PT03',
     'Puerta de acceso a la bodega principal, sector de carga.',
     40.414700, -3.709500, 50, 1);

-- --- Rondas ----------------------------------------------------------------
-- ``last_activity_at`` alimenta el plazo de inactividad de 20 minutos y
-- ``paused_at``/``paused_seconds`` permiten reanudar el cronómetro.
INSERT IGNORE INTO `rounds`
    (`id`, `company_id`, `guard_id`, `status`, `start_time`, `end_time`,
     `paused_at`, `paused_seconds`, `last_activity_at`, `cancel_reason`,
     `observations`, `created_at`)
VALUES
    (1, 1, 3, 'COMPLETED',
     DATE_SUB(NOW(), INTERVAL 2 HOUR), DATE_SUB(NOW(), INTERVAL 1 HOUR),
     NULL, 0, DATE_SUB(NOW(), INTERVAL 1 HOUR), NULL,
     'Ronda sin incidencias.', DATE_SUB(NOW(), INTERVAL 2 HOUR)),
    (2, 1, 3, 'IN_PROGRESS',
     DATE_SUB(NOW(), INTERVAL 30 MINUTE), NULL,
     NULL, 0, DATE_SUB(NOW(), INTERVAL 5 MINUTE), NULL,
     'Ronda en curso: pendiente el resto de checkpoints.',
     DATE_SUB(NOW(), INTERVAL 30 MINUTE)),
    (3, 2, 3, 'COMPLETED',
     DATE_SUB(NOW(), INTERVAL 1 DAY), DATE_SUB(NOW(), INTERVAL 23 HOUR),
     NULL, 0, DATE_SUB(NOW(), INTERVAL 23 HOUR), NULL,
     'Se detectó una puerta de servicio abierta.', DATE_SUB(NOW(), INTERVAL 1 DAY)),
    (4, 2, 5, 'PENDING', NULL, NULL,
     NULL, 0, NULL, NULL, NULL, DATE_SUB(NOW(), INTERVAL 10 MINUTE)),
    (5, 1, 5, 'CANCELLED',
     DATE_SUB(NOW(), INTERVAL 2 DAY), DATE_SUB(NOW(), INTERVAL 2 DAY) + INTERVAL 5 MINUTE,
     NULL, 0, DATE_SUB(NOW(), INTERVAL 2 DAY) + INTERVAL 5 MINUTE,
     'Ronda cancelada por el cliente.',
     'Ronda cancelada por el cliente.', DATE_SUB(NOW(), INTERVAL 2 DAY)),
    (6, 1, 5, 'PAUSED',
     DATE_SUB(NOW(), INTERVAL 45 MINUTE), NULL,
     DATE_SUB(NOW(), INTERVAL 10 MINUTE), 0,
     DATE_SUB(NOW(), INTERVAL 10 MINUTE), NULL,
     'Ronda pausada por una emergencia; puede continuarse desde el historial.',
     DATE_SUB(NOW(), INTERVAL 45 MINUTE));

-- --- Checkpoints NFC/QR ----------------------------------------------------
INSERT INTO `round_logs`
    (`round_id`, `checkpoint_id`, `nfc_tag_id`, `checkpoint_name`,
     `elapsed_seconds`, `timestamp`, `status`)
VALUES
    (1, 1, 'QR-EMP1-PT01', 'Recepción',
     300, DATE_SUB(NOW(), INTERVAL 115 MINUTE), 'OK'),
    (1, 2, 'QR-EMP1-PT02', 'Estacionamiento Nivel -1',
     900, DATE_SUB(NOW(), INTERVAL 105 MINUTE), 'OK'),
    (1, 3, 'QR-EMP1-PT03', 'Bodega Principal',
     1500, DATE_SUB(NOW(), INTERVAL 95 MINUTE), 'OK'),
    (2, 1, 'QR-EMP1-PT01', 'Recepción',
     240, DATE_SUB(NOW(), INTERVAL 25 MINUTE), 'OK'),
    (3, NULL, 'NFC-0001', 'Entrada principal',
     300, DATE_SUB(NOW(), INTERVAL 1 DAY) + INTERVAL 5 MINUTE, 'OK'),
    (3, NULL, 'NFC-0010', 'Patio trasero',
     900, DATE_SUB(NOW(), INTERVAL 1 DAY) + INTERVAL 25 MINUTE, 'INCIDENT'),
    (3, NULL, 'NFC-0002', 'Recepción',
     1500, DATE_SUB(NOW(), INTERVAL 1 DAY) + INTERVAL 40 MINUTE, 'OK'),
    (6, 1, 'QR-EMP1-PT01', 'Recepción',
     600, DATE_SUB(NOW(), INTERVAL 40 MINUTE), 'OK'),
    (6, 2, 'QR-EMP1-PT02', 'Estacionamiento Nivel -1',
     1200, DATE_SUB(NOW(), INTERVAL 20 MINUTE), 'OK');
