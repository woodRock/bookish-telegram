import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Define the directory to save the extracted model
    // For now, let's save it in a 'local_models' directory at the root of the project.
    // This might need to be configurable or more robust for production.
    const uploadDir = path.join(process.cwd(), 'local_models');
    await fs.mkdir(uploadDir, { recursive: true });

    const zipFilePath = path.join(uploadDir, file.name);
    await fs.writeFile(zipFilePath, buffer);

    const zip = new AdmZip(zipFilePath);
    const modelName = file.name.replace(/\.zip$/, ''); // Use zip file name as model name

    const modelExtractPath = path.join(uploadDir, modelName);
    await fs.mkdir(modelExtractPath, { recursive: true });
    zip.extractAllTo(modelExtractPath, true);

    // Clean up the uploaded zip file
    await fs.unlink(zipFilePath);

    return NextResponse.json({ message: 'Model uploaded and extracted successfully', modelPath: `local_models/${modelName}` });
  } catch (error) {
    console.error('Error uploading model:', error);
    return NextResponse.json({ error: 'Failed to upload model' }, { status: 500 });
  }
}
