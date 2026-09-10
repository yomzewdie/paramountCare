'use client';

import { User } from 'lucide-react';
import { PersonalInfo } from '@/types/onboarding';
import type { FieldErrors } from '@/lib/validation';
import { Card, CardBody } from '@/components/ui/Card';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Input, Select } from '@/components/ui/FormField';

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
];

interface PersonalInfoSectionProps {
  data: PersonalInfo;
  onChange: (data: PersonalInfo) => void;
  errors?: FieldErrors;
}

export function PersonalInfoSection({ data, onChange, errors = {} }: PersonalInfoSectionProps) {
  const update = (field: keyof PersonalInfo) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      onChange({ ...data, [field]: e.target.value });

  return (
    <div className="space-y-4">
      <Card>
        <SectionHeader
          icon={<User size={20} />}
          title="Personal Information"
          description="Enter your full legal name and contact details. Sensitive identity information (date of birth, SSN) will be collected in the Form I-9 step."
        />
        <CardBody>
          {/* Full legal name — I-9 field order: Last, First, Middle */}
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-4">Legal Name</p>
          <div className="grid grid-cols-1 sm:grid-cols-6 gap-5 mb-7">
            <div className="sm:col-span-3">
              <Input
                label="Last Name"
                required
                placeholder="Smith"
                value={data.lastName}
                onChange={update('lastName')}
                autoComplete="family-name"
                error={errors.lastName}
              />
            </div>
            <div className="sm:col-span-2">
              <Input
                label="First Name"
                required
                placeholder="Jane"
                value={data.firstName}
                onChange={update('firstName')}
                autoComplete="given-name"
                error={errors.firstName}
              />
            </div>
            <div className="sm:col-span-1">
              <Input
                label="M.I."
                placeholder="A"
                value={data.middleInitial}
                onChange={update('middleInitial')}
                maxLength={1}
                hint="Optional"
              />
            </div>
            <div className="sm:col-span-6">
              <Input
                label="Other Last Names Used"
                placeholder="Maiden name, alias, or N/A"
                value={data.otherLastNames}
                onChange={update('otherLastNames')}
                hint="Include all names under which you have been previously employed (e.g., maiden name)"
              />
            </div>
          </div>

          {/* Contact */}
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-4">Contact Information</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-7">
            <Input
              label="Email Address"
              required
              type="email"
              placeholder="jane@example.com"
              value={data.email}
              onChange={update('email')}
              autoComplete="email"
              className="sm:col-span-2"
              error={errors.email}
            />
            <Input
              label="Phone Number"
              required
              type="tel"
              placeholder="(555) 000-0000"
              value={data.phone}
              onChange={update('phone')}
              autoComplete="tel"
              error={errors.phone}
            />
          </div>

          {/* Address — I-9 Section 1 address fields */}
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-4">Home Address</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Input
              label="Street Address"
              required
              placeholder="123 Main Street"
              value={data.address}
              onChange={update('address')}
              autoComplete="street-address"
              error={errors.address}
              className="sm:col-span-2"
            />
            <Input
              label="Apt. / Unit Number"
              placeholder="Apt 4B"
              value={data.aptNumber}
              onChange={update('aptNumber')}
              hint="Optional"
            />
            <Input
              label="City or Town"
              required
              placeholder="Los Angeles"
              value={data.city}
              onChange={update('city')}
              autoComplete="address-level2"
              error={errors.city}
            />
            <Select
              label="State"
              required
              value={data.state}
              onChange={update('state')}
              autoComplete="address-level1"
              error={errors.state}
            >
              <option value="">Select state</option>
              {US_STATES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
            <Input
              label="ZIP Code"
              required
              placeholder="90001"
              value={data.zip}
              onChange={update('zip')}
              autoComplete="postal-code"
              maxLength={10}
              error={errors.zip}
            />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
