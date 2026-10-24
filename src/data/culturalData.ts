import heroScannerImg from '../assets/images/hero_smart_guardian_scanner_1792863783488.jpg';
import incenseFrontImg from '../assets/images/artifact_incense_front_1792859807152.jpg';
import incenseRightImg from '../assets/images/artifact_incense_right_1792859807491.jpg';
import incenseBackImg from '../assets/images/artifact_incense_back_1792859809257.jpg';
import incenseTopImg from '../assets/images/artifact_incense_top_1792859810398.jpg';
import { CaptureDirection } from '../types/artifact';

export const HERO_SCANNER_IMAGE = heroScannerImg;

export const INCENSE_ARTIFACT_IMAGES: Record<string, string> = {
  [CaptureDirection.Front]: incenseFrontImg,
  [CaptureDirection.Right]: incenseRightImg,
  [CaptureDirection.Back]: incenseBackImg,
  [CaptureDirection.Top]: incenseTopImg,
};

