-- Add missing columns to incidents
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS triage_color text;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS volunteer_types text[] DEFAULT '{}';
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS estimated_minutes integer;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS reporter_phone text;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS volunteer_status text DEFAULT 'assigned';
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS volunteer_status_updated_at timestamptz;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS dispatch_status text;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS resolved_by text;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS resolution_notes text;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS escalated_at timestamptz;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS escalated_by text;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS escalation_notes text;

-- Add reporter_id FK to auth.users if not already (it's uuid, which references auth.users)
-- incidents.reporter_id already exists as uuid type

-- Add missing columns to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS total_reports integer DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name text;
UPDATE users SET full_name = name WHERE full_name IS NULL;

-- Add missing columns to volunteers
ALTER TABLE volunteers ADD COLUMN IF NOT EXISTS uid text;
ALTER TABLE volunteers ADD COLUMN IF NOT EXISTS last_assigned_at timestamptz;

-- Add metadata to resources
ALTER TABLE resources ADD COLUMN IF NOT EXISTS timestamp timestamptz;
