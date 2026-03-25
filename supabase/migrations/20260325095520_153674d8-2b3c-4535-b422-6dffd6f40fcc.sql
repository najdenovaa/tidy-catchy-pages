
-- Create storage bucket for analysis documents
INSERT INTO storage.buckets (id, name, public) VALUES ('analysis-docs', 'analysis-docs', false);

-- RLS policies for the bucket
CREATE POLICY "Authenticated users can upload analysis docs"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'analysis-docs');

CREATE POLICY "Users can view own analysis docs"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'analysis-docs' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can delete own analysis docs"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'analysis-docs' AND (storage.foldername(name))[1] = auth.uid()::text);
