import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const modelPath = searchParams.get('modelPath');
  const fileName = searchParams.get('fileName');

  if (!modelPath || !fileName) {
    return NextResponse.json({ error: 'Model path and file name are required' }, { status: 400 });
  }

  // Ensure modelPath starts with 'local_models/' for security
  if (!modelPath.startsWith('local_models/')) {
    return NextResponse.json({ error: 'Invalid model path' }, { status: 400 });
  }

  const filePath = path.join(process.cwd(), modelPath, fileName);

  try {
    const fileBuffer = await fs.readFile(filePath);
    const contentType = getContentType(fileName); // Helper to determine content type

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    console.error(`Error reading local model file ${filePath}:`, error);
    return NextResponse.json({ error: 'File not found or internal server error' }, { status: 404 });
  }
}

function getContentType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  switch (ext) {
    case '.json':
      return 'application/json';
    case '.bin':
      return 'application/octet-stream';
    case '.safetensors':
      return 'application/octet-stream';
    case '.onnx':
      return 'application/octet-stream';
    case '.txt':
      return 'text/plain';
    // Add more content types as needed
    default:
      return 'application/octet-stream';
  }
}
