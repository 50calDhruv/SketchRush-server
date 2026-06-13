const CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export const generateRoomId = () => {
  let id = "";

  for (let i = 0; i < 6; i++) {
    id += CHARS[
      Math.floor(Math.random() * CHARS.length)
    ];
  }

  return id;
};