export interface OcrResult {
  text: string;
  confidence: number;
  suggestedSerial: string;
}

// Recognize serial number from image using Google Cloud Vision API
export async function recognizeSerialNumber(imageData: string): Promise<OcrResult> {
  try {
    const response = await fetch('/.netlify/functions/ocr-vision', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ imageData }),
    });

    if (!response.ok) {
      throw new Error(`OCR request failed: ${response.status}`);
    }

    const result = await response.json();

    return {
      text: result.text || '',
      confidence: result.confidence || 0,
      suggestedSerial: result.suggestedSerial || '',
    };
  } catch (error) {
    console.error('OCR error:', error);
    throw error;
  }
}

// Format serial number for consistent comparison
export function formatSerialNumber(serial: string): string {
  return serial.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}
