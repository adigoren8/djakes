# Maintainance

Run locally:

```
$ npm run start-mac
```

Push to railway:

```
$ railway up
```

# Heroku - Deprecated

Push to heroku:

```
$ git push heroku master
```

Logs

```
$ heroku logs --tails
```

## Once-time setup

Install chromedriver in heroku

```
$ heroku buildpacks:add --index 1 https://github.com/heroku/heroku-buildpack-chromedriver
$ heroku buildpacks:add --index 2 https://github.com/heroku/heroku-buildpack-google-chrome
```

set a version for chrome and chromedrvier:

```
$ heroku config:set CHROMEDRIVER_VERSION="101.0.4951.41"
```

Add the app here:
https://kaffeine.herokuapp.com/
