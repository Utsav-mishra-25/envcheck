# Ruby: ENV[...] with both quote styles and ENV.fetch.
class Mailer
  HOST = ENV["SMTP_HOST"]
  PASSWORD = ENV['SMTP_PASSWORD']
  FROM = ENV.fetch("MAILER_FROM")
  REPLY_TO = ENV.fetch('MAILER_REPLY_TO', 'support@example.com')
end
