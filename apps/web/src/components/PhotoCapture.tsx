import { useEffect, useState } from 'react';
import { compressImage } from '../offline/photo';
import { savePhoto } from '../offline/sync';
import { clock } from '../lib/format';

/**
 * Camera capture for proof of delivery and shortfall photos. The photo is compressed and queued
 * on the device immediately, so it works with no signal and never blocks the next stop.
 */
export function PhotoCapture({ label, photoId, onChange, prompt = 'Take a photo of the goods' }: { label: string; photoId: string | null; onChange: (id: string | null) => void; prompt?: string }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [at, setAt] = useState<Date | null>(null);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  return (
    <label className={`photo ${photoId ? 'done' : ''}`} style={{ cursor: 'pointer' }}>
      <input
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const blob = await compressImage(file);
          const id = await savePhoto(blob, label);
          setPreview(URL.createObjectURL(blob));
          setAt(new Date());
          onChange(id);
        }}
      />
      {photoId && preview ? (
        <>
          <img src={preview} alt="Photo taken for this record" />
          <span className="stamp">Photo saved on phone, {clock(at)}</span>
        </>
      ) : (
        <span>{prompt}</span>
      )}
    </label>
  );
}
