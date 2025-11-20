import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const modelPath = searchParams.get('modelPath');
  const fileName = searchParams.get('fileName');

  if (!modelPath || !fileName) {
    return NextResponse.json({ error: 'Model path and file name are required' }, { status: 400 });
  }

  const huggingFaceBaseUrl = `https://huggingface.co/${modelPath}/resolve/main`;
  const fileUrl = `${huggingFaceBaseUrl}/${fileName}`;

  try {
    const response = await fetch(fileUrl);

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch ${fileName} from Hugging Face: ${response.statusText}` },
        { status: response.status }
      );
    }

    // Stream the file content directly
    return new NextResponse(response.body, {
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    console.error(`Error fetching ${fileName} for ${modelPath}:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
