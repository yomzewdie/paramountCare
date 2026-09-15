import { useCallback, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import type { UploadedFile } from '@pcs/shared';
import { uploadFile, type PickedFile } from './uploadApi';

export type AttachmentStatus = 'idle' | 'uploading' | 'uploaded' | 'failed';

export interface AttachmentState {
  status: AttachmentStatus;
  file: UploadedFile | null;
  errorMessage: string | null;
}

/**
 * A single-file attachment's full lifecycle — pick (library, camera, or
 * document), upload through the authenticated `/api/uploads` Worker route,
 * retry on failure, remove/replace before completion. Built generic (no
 * Direct-Deposit-specific field names) so the next screen that needs an
 * attachment — e.g. a future `documents` step — reuses this hook rather
 * than inventing its own upload plumbing (see uploadApi.ts).
 *
 * State lives only in memory, seeded from whatever `UploadedFile` the
 * session already has (server-backed, via `initial`) — never written to
 * AsyncStorage/SecureStore. A cold app restart restores it from the
 * session's own formData, the same way every other field on this screen
 * restores, not from any local cache of this hook's own.
 *
 * `onUploaded`, when given, fires right after a successful upload so the
 * caller can persist the resulting `UploadedFile` to the session
 * immediately — e.g. Direct Deposit saves it the moment the voided check
 * finishes uploading, rather than waiting for the applicant to separately
 * tap Save Progress, so the attachment survives an app restart even if
 * that never happens.
 */
export function useFileAttachment(initial: UploadedFile | null, onUploaded?: (file: UploadedFile) => void) {
  const [state, setState] = useState<AttachmentState>({
    status: initial ? 'uploaded' : 'idle',
    file: initial,
    errorMessage: null,
  });
  const [pending, setPending] = useState<PickedFile | null>(null);

  const doUpload = useCallback(async (picked: PickedFile) => {
    setPending(picked);
    setState({ status: 'uploading', file: null, errorMessage: null });
    const result = await uploadFile(picked);
    if (result.ok) {
      setPending(null);
      setState({ status: 'uploaded', file: result.data, errorMessage: null });
      onUploaded?.(result.data);
    } else {
      setState({ status: 'failed', file: null, errorMessage: result.error.message });
    }
  }, [onUploaded]);

  const pickFromLibrary = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setState({ status: 'failed', file: null, errorMessage: 'Photo library access is required to attach a file.' });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    const asset = result.canceled ? undefined : result.assets?.[0];
    if (!asset) return;
    await doUpload({ uri: asset.uri, name: asset.fileName ?? 'photo.jpg', type: asset.mimeType ?? 'image/jpeg', size: asset.fileSize });
  }, [doUpload]);

  const takePhoto = useCallback(async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setState({ status: 'failed', file: null, errorMessage: 'Camera access is required to take a photo.' });
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    const asset = result.canceled ? undefined : result.assets?.[0];
    if (!asset) return;
    await doUpload({ uri: asset.uri, name: asset.fileName ?? 'photo.jpg', type: asset.mimeType ?? 'image/jpeg', size: asset.fileSize });
  }, [doUpload]);

  const pickDocument = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/jpeg', 'image/png'] });
    const asset = result.canceled ? undefined : result.assets?.[0];
    if (!asset) return;
    await doUpload({ uri: asset.uri, name: asset.name, type: asset.mimeType ?? 'application/pdf', size: asset.size ?? undefined });
  }, [doUpload]);

  const retry = useCallback(() => {
    if (pending) void doUpload(pending);
  }, [pending, doUpload]);

  const remove = useCallback(() => {
    setPending(null);
    setState({ status: 'idle', file: null, errorMessage: null });
  }, []);

  return {
    ...state,
    pickFromLibrary,
    takePhoto,
    pickDocument,
    retry,
    remove,
    /** Uploads an already-picked (and, for the smart-capture path, already
     * locally validated + applicant-confirmed) file directly — the entry
     * point `useDocumentCapture.ts` calls once the applicant taps "Use
     * Document," skipping this hook's own OS-picker calls above (which
     * upload immediately with no preview/confirm step of their own). */
    uploadPicked: doUpload,
  };
}
