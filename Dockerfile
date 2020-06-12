FROM node:10.19.0-alpine

MAINTAINER mark

RUN mkdir -p /opt/jpm
WORKDIR /opt/jpm

COPY package*.json ./

RUN apk add --no-cache --virtual .build-deps alpine-sdk python \
&& npm install -g mocha eslint nodemon \
&& npm install \
&& apk del .build-deps

COPY . ./

CMD npm start
