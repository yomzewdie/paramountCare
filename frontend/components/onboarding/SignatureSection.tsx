'use client';

import { useRef, useState, useCallback } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import { PenLine, Trash2, Keyboard, Pencil } from 'lucide-react';
import { SignatureData } from '@/types/onboarding';
import { Card, CardBody } from '@/components/ui/Card';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/FormField';

type SignatureMode = 'draw' | 'type';

interface SignatureSectionProps {
  data: SignatureData;
  onChange: (data: SignatureData) => void;
}

export function SignatureSection({ data, onChange }: SignatureSectionProps) {
  const sigCanvasRef = useRef<SignatureCanvas>(null);
  const [mode, setMode] = useState<SignatureMode>('draw');
  const [isEmpty, setIsEmpty] = useState(!data.signatureDataUrl);

  const handleEnd = useCallback(() => {
    if (sigCanvasRef.current && !sigCanvasRef.current.isEmpty()) {
      const dataUrl = sigCanvasRef.current.getTrimmedCanvas().toDataURL('image/png');
      setIsEmpty(false);
      onChange({
        ...data,
        signatureDataUrl: dataUrl,
        signedDate: new Date().toLocaleDateString('en-US', {
          year: 'numeric', month: 'long', day: 'numeric',
        }),
      });
    }
  }, [data, onChange]);

  const handleClear = () => {
    sigCanvasRef.current?.clear();
    setIsEmpty(true);
    onChange({ ...data, signatureDataUrl: null, signedDate: '' });
  };

  const handleTypedName = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    onChange({
      ...data,
      typedName: value,
      signatureDataUrl: value ? 'typed' : null,
      signedDate: value
        ? new Date().toLocaleDateString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric',
          })
        : '',
    });
  };

  const switchMode = (newMode: SignatureMode) => {
    setMode(newMode);
    handleClear();
    onChange({ signatureDataUrl: null, typedName: '', signedDate: '' });
    setIsEmpty(true);
  };

  const hasSignature =
    mode === 'draw' ? !isEmpty && !!data.signatureDataUrl
    : !!data.typedName.trim();

  return (
    <Card>
      <SectionHeader
        icon={<PenLine size={20} />}
        title="Signature"
        description="Sign your name to certify that all information provided is accurate and complete."
        iconColor="bg-pink-50 text-pink-600"
      />
      <CardBody>
        {/* Mode toggle */}
        <div className="flex gap-2 p-1 bg-slate-100 rounded-xl mb-5 w-fit">
          <button
            type="button"
            onClick={() => switchMode('draw')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              mode === 'draw'
                ? 'bg-white text-slate-800 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Pencil size={14} />
            Draw
          </button>
          <button
            type="button"
            onClick={() => switchMode('type')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              mode === 'type'
                ? 'bg-white text-slate-800 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Keyboard size={14} />
            Type
          </button>
        </div>

        {mode === 'draw' ? (
          <div>
            <p className="text-xs font-medium text-slate-400 mb-2 uppercase tracking-wide">
              Draw your signature below
            </p>
            <div className="relative border-2 border-slate-200 rounded-xl overflow-hidden bg-white">
              <SignatureCanvas
                ref={sigCanvasRef}
                canvasProps={{
                  className: 'signature-canvas w-full',
                  style: { height: '180px', display: 'block' },
                }}
                onEnd={handleEnd}
                penColor="#1e293b"
                minWidth={1.5}
                maxWidth={3}
                dotSize={2}
              />
              {isEmpty && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <p className="text-slate-300 text-sm select-none">Sign here…</p>
                </div>
              )}
              <div className="absolute bottom-0 left-6 right-6 border-b border-dashed border-slate-200" />
            </div>
            <div className="mt-3 flex justify-between items-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClear}
                disabled={isEmpty}
              >
                <Trash2 size={14} />
                Clear
              </Button>
              {hasSignature && (
                <span className="text-xs text-emerald-600 font-medium">Signature captured ✓</span>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <Input
              label="Type your full legal name"
              required
              placeholder="Jane Smith"
              value={data.typedName}
              onChange={handleTypedName}
              className="text-lg"
            />
            {data.typedName && (
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                <p className="text-xs text-slate-400 mb-2 uppercase tracking-wide">Signature preview</p>
                <p
                  className="text-3xl text-slate-800 leading-tight"
                  style={{ fontFamily: "'Georgia', 'Times New Roman', serif", fontStyle: 'italic' }}
                >
                  {data.typedName}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Legal notice + date */}
        <div className="mt-5 p-4 bg-slate-50 rounded-xl border border-slate-100">
          <p className="text-xs text-slate-500 leading-relaxed">
            By signing above, I certify that all information provided in this onboarding form is accurate,
            complete, and truthful to the best of my knowledge. I understand that any misrepresentation
            may result in disqualification or termination.
          </p>
          {data.signedDate && (
            <p className="text-xs font-semibold text-slate-600 mt-2">
              Signed on: {data.signedDate}
            </p>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
