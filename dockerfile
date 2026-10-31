FROM node:20

# Membuat direktori kerja di dalam server
WORKDIR /app

# Menyalin file package.json dan menginstal library (baileys, express, dll)
COPY package*.json ./
RUN npm install

# Menyalin seluruh kode (termasuk index.js)
COPY . .

# Membuka port web uploader
EXPOSE 3000

# Perintah untuk menjalankan bot
CMD ["node", "index.js"]
  
