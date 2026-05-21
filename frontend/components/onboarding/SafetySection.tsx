'use client';

import { ShieldCheck, Check, BookOpen } from 'lucide-react';
import { SafetyEducationData } from '@/types/onboarding';
import { Card, CardBody } from '@/components/ui/Card';
import { SectionHeader } from '@/components/ui/SectionHeader';

// Derived from the Paramount Care Staffing Safety & Education Exam (25-question answer sheet)
// Organized into topic-level acknowledgements for the digital onboarding experience
const SAFETY_TOPICS: {
  key: keyof Omit<SafetyEducationData, 'examAttestation'>;
  title: string;
  description: string;
}[] = [
  {
    key: 'patientSafety',
    title: 'Patient Safety & Fall Prevention',
    description:
      'I understand fall risk assessment procedures, bed rail policies, call light placement, and patient identification protocols. I will apply appropriate fall prevention interventions for all patients in my care.',
  },
  {
    key: 'infectionControl',
    title: 'Infection Control & Standard Precautions',
    description:
      'I understand and will comply with standard precautions including proper hand hygiene, appropriate use of PPE, isolation precaution categories (Contact, Droplet, Airborne), and correct donning/doffing procedures.',
  },
  {
    key: 'fireSafety',
    title: 'Fire Safety & Emergency Response',
    description:
      'I understand the RACE protocol (Rescue, Alarm, Contain, Extinguish) and PASS technique (Pull, Aim, Squeeze, Sweep). I know facility emergency codes, evacuation procedures, and my assigned responsibilities.',
  },
  {
    key: 'patientRightsHipaa',
    title: 'Patient Rights, Privacy & HIPAA',
    description:
      'I understand patient rights including the right to informed consent, advance directives, and confidentiality. I will comply with all HIPAA Privacy and Security Rule requirements and will not disclose protected health information improperly.',
  },
  {
    key: 'workplaceViolence',
    title: 'Workplace Violence Prevention',
    description:
      'I understand the facility zero-tolerance policy on workplace violence. I am familiar with de-escalation techniques, how to identify warning signs, and the proper channels for reporting threatening or violent behavior.',
  },
  {
    key: 'backSafety',
    title: 'Body Mechanics & Safe Patient Handling',
    description:
      'I understand proper body mechanics for safe patient care, including correct lifting techniques, use of assistive devices and mechanical lifts, and procedures for repositioning or transferring patients to prevent injury.',
  },
  {
    key: 'hazardousMaterials',
    title: 'Hazardous Materials & Bloodborne Pathogens',
    description:
      'I understand OSHA Bloodborne Pathogen standards, proper handling and disposal of sharps and biohazardous waste, Safety Data Sheet (SDS) access, and the post-exposure protocol in the event of a needlestick or body fluid exposure.',
  },
  {
    key: 'documentationStandards',
    title: 'Documentation & Mandatory Reporting',
    description:
      'I understand the standards for accurate, timely, and complete medical documentation. I am aware of my mandatory reporting obligations, including reporting of abuse, neglect, incidents, and safety concerns through proper channels.',
  },
];

interface SafetySectionProps {
  data: SafetyEducationData;
  onChange: (data: SafetyEducationData) => void;
}

export function SafetySection({ data, onChange }: SafetySectionProps) {
  const toggle = (key: keyof SafetyEducationData) =>
    onChange({ ...data, [key]: !data[key] });

  const topicsChecked = SAFETY_TOPICS.filter((t) => data[t.key]).length;
  const allTopicsChecked = topicsChecked === SAFETY_TOPICS.length;

  return (
    <div className="space-y-4">
      {/* Header card */}
      <Card>
        <SectionHeader
          icon={<BookOpen size={20} />}
          title="Safety & Education Exam"
          description="Paramount Care Staffing, LLC — Safety & Education Orientation"
          iconColor="bg-emerald-50 text-emerald-600"
        />
        <CardBody>
          <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-xl mb-5">
            <p className="text-sm text-emerald-800 leading-relaxed">
              Review each safety topic below and acknowledge that you have read, understood, and will comply
              with the policies and procedures covered in the Paramount Care Staffing Safety &amp; Education Exam.
              You will complete a 25-question written exam during your in-person orientation.
            </p>
          </div>

          <div className="space-y-3">
            {SAFETY_TOPICS.map((topic) => {
              const checked = data[topic.key];
              return (
                <button
                  key={topic.key}
                  type="button"
                  onClick={() => toggle(topic.key)}
                  className={`
                    w-full text-left flex items-start gap-4 p-4 rounded-xl border transition-all duration-150
                    ${checked
                      ? 'bg-emerald-50 border-emerald-200'
                      : 'bg-slate-50 border-slate-200 hover:border-emerald-200 hover:bg-emerald-50/40'}
                  `}
                >
                  <div
                    className={`
                      mt-0.5 w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center transition-all
                      ${checked ? 'bg-emerald-500 border-emerald-500' : 'border-slate-300 bg-white'}
                    `}
                  >
                    {checked && <Check size={11} className="text-white" strokeWidth={3} />}
                  </div>
                  <div className="min-w-0">
                    <p className={`text-sm font-semibold mb-1 ${checked ? 'text-emerald-800' : 'text-slate-800'}`}>
                      {topic.title}
                    </p>
                    <p className={`text-sm leading-relaxed ${checked ? 'text-emerald-700' : 'text-slate-500'}`}>
                      {topic.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Progress indicator */}
          <div className="mt-5 flex items-center justify-between text-xs text-slate-500">
            <span>{topicsChecked} of {SAFETY_TOPICS.length} topics acknowledged</span>
            <div className="w-32 h-1.5 bg-slate-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                style={{ width: `${(topicsChecked / SAFETY_TOPICS.length) * 100}%` }}
              />
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Final attestation — only shown after all topics checked */}
      {allTopicsChecked && (
        <Card>
          <CardBody>
            <button
              type="button"
              onClick={() => toggle('examAttestation')}
              className={`
                w-full text-left flex items-start gap-4 p-4 rounded-xl border transition-all
                ${data.examAttestation
                  ? 'bg-emerald-50 border-emerald-200'
                  : 'bg-slate-50 border-slate-200 hover:border-emerald-200'}
              `}
            >
              <div
                className={`
                  mt-0.5 w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center transition-all
                  ${data.examAttestation ? 'bg-emerald-500 border-emerald-500' : 'border-slate-300 bg-white'}
                `}
              >
                {data.examAttestation && <Check size={11} className="text-white" strokeWidth={3} />}
              </div>
              <div>
                <p className={`text-sm font-semibold mb-1 ${data.examAttestation ? 'text-emerald-800' : 'text-slate-800'}`}>
                  Safety & Education Exam Attestation
                </p>
                <p className={`text-sm leading-relaxed ${data.examAttestation ? 'text-emerald-700' : 'text-slate-500'}`}>
                  I confirm that I have reviewed all safety and education topics listed above. I understand
                  that I will complete the 25-question Safety &amp; Education Exam during my in-person orientation
                  with Paramount Care Staffing, LLC. I agree to comply with all safety policies and procedures
                  at all facilities where I am placed.
                </p>
              </div>
            </button>
          </CardBody>
        </Card>
      )}

      {/* All complete banner */}
      {data.examAttestation && (
        <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
          <ShieldCheck size={20} className="text-emerald-600 flex-shrink-0" />
          <p className="text-sm font-semibold text-emerald-700">
            Safety & Education orientation complete. Thank you for your commitment to a safe workplace.
          </p>
        </div>
      )}
    </div>
  );
}
