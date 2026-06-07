FROM node:20

# Create app directory
WORKDIR /app

# Install app dependencies
# Copy package.json and package-lock.json first to cache layers
COPY package*.json ./

# Install packages
RUN npm install

# Expose port 11122
EXPOSE 11122

# Default command starts the dev script (uses tsx watch)
CMD ["npm", "run", "dev"]
