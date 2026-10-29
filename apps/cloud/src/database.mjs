import postgres from 'postgres';
export const database = (url) => postgres(url, { max: 3, idle_timeout: 20, connect_timeout: 10, prepare: false });
