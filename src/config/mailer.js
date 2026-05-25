// const nodemailer = require("nodemailer");

// const transporter = nodemailer.createTransport({
//   service: "gmail",
//   auth: {
//     user: process.env.EMAIL_USER,
//     pass: process.env.EMAIL_PASS,
//   },
// });

// const sendOtp = async (email, otp) => {
//   await transporter.sendMail({
//     from: process.env.EMAIL_USER,
//     to: email,
//     subject: "Your OTP",
//     text: `Your OTP is ${otp}`,
//   });
// };

// module.exports = sendOtp;


const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

const sendOtp = async (email, otp) => {
  try {
    const response = await resend.emails.send({
      from: "onboarding@resend.dev",
      to: email,
      subject: "Your OTP",
      html: `
        <div>
          <h2>Your OTP Code</h2>
          <p>Your OTP is:</p>
          <h1>${otp}</h1>
        </div>
      `,
    });

    console.log("MAIL SENT:", response);
  } catch (error) {
    console.log("MAIL ERROR:", error);
    throw error;
  }
};

module.exports = sendOtp;