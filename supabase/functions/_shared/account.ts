export const normalizeUsername = (value: string) => value.trim().toLowerCase();

export const validUsername = (value: string) => /^[a-z0-9][a-z0-9._-]{2,31}$/.test(value);

export const validPassword = (value: string) => value.length >= 10 && value.length <= 72;

export const loginEmail = (username: string) => `${username}@users.diegohomelab.fyi`;
