FROM node:20

# Create app directory and set ownership to node
WORKDIR /app
RUN chown -R node:node /app

# Switch to the node user
USER node

# Copy package files as the node user
COPY --chown=node:node package*.json ./

# Install packages
RUN npm install

# Expose port 11122
EXPOSE 11122

# Default command starts the dev script (uses tsx watch)
CMD ["npm", "run", "dev"]

