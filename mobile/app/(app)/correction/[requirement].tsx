import { useLocalSearchParams } from 'expo-router';
import CorrectionScreen from '../../../src/features/onboarding/CorrectionScreen';

// Fixing one document a recruiter sent back (see CorrectionScreen).
export default function CorrectionRoute() {
  const { requirement } = useLocalSearchParams<{ requirement: string }>();
  return <CorrectionScreen requirement={String(requirement ?? '')} />;
}
