function required(name: string, minLength = 1): string {
  const value = process.env[name];
  if (!value || value.length < minLength) {
    throw new Error(`Переменная окружения ${name} не задана или слишком короткая`);
  }
  return value;
}

export const env = {
  get supabaseUrl() {
    return required('SUPABASE_URL').replace(/\/+$/, '');
  },
  get supabaseServiceKey() {
    return required('SUPABASE_SERVICE_KEY');
  },
  get adminPassword() {
    return required('ADMIN_PASSWORD', 12);
  },
  get sessionSecret() {
    return required('SESSION_SECRET', 32);
  },
};
