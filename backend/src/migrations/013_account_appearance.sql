ALTER TABLE accounts ADD COLUMN color TEXT;
ALTER TABLE accounts ADD COLUMN avatar BLOB;
ALTER TABLE accounts ADD COLUMN avatar_mime TEXT;
ALTER TABLE accounts ADD COLUMN avatar_updated_at INTEGER;

UPDATE accounts SET color = CASE abs(random()) % 12
  WHEN 0 THEN '#2563eb'
  WHEN 1 THEN '#7c3aed'
  WHEN 2 THEN '#db2777'
  WHEN 3 THEN '#dc2626'
  WHEN 4 THEN '#ea580c'
  WHEN 5 THEN '#b45309'
  WHEN 6 THEN '#15803d'
  WHEN 7 THEN '#0f766e'
  WHEN 8 THEN '#0891b2'
  WHEN 9 THEN '#4f46e5'
  WHEN 10 THEN '#a21caf'
  WHEN 11 THEN '#475569'
END WHERE color IS NULL;
