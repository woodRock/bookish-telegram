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

    const uploadDir = path.join(process.cwd(), 'local_models');
    await fs.mkdir(uploadDir, { recursive: true });

    const zipFilePath = path.join(uploadDir, file.name);
    await fs.writeFile(zipFilePath, buffer);

    const zip = new AdmZip(zipFilePath);
    const modelName = file.name.replace(/\.zip$/, '');

    const modelExtractPath = path.join(uploadDir, modelName);
    await fs.mkdir(modelExtractPath, { recursive: true });

    // Extract all files, preserving their directory structure
    zip.getEntries().forEach(entry => {
      if (!entry.isDirectory) {
        const entryPath = path.join(modelExtractPath, entry.entryName);
        const entryDir = path.dirname(entryPath);
        fs.mkdir(entryDir, { recursive: true }).then(() => {
          fs.writeFile(entryPath, entry.getData());
        });
      }
    });

    await fs.unlink(zipFilePath);

    return NextResponse.json({ message: 'Model uploaded and extracted successfully', modelPath: `local_models/${modelName}` });
  } catch (error) {
    console.error('Error uploading model:', error);
    return NextResponse.json({ error: 'Failed to upload model' }, { status: 500 });
  }
}
